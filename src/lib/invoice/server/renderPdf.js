const PDFDocument = require('pdfkit')
const {
  buildCommercialInvoice,
  commercialInvoiceTableRows,
  invoiceDocumentTitle,
} = require('./commercialInvoice')

const INK = '#111111'
const MUTED = '#444444'
const RULE = '#222222'
const RULE_LIGHT = '#888888'
const HEADER_FILL = '#F3F3F3'
const TOTAL_FILL = '#111111'

function inr(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '0.00'
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function wrapText(value, fallback = '—') {
  const text = value != null ? String(value).trim() : ''
  return text || fallback
}

async function loadLogoBuffer(logoUrl) {
  const url = String(logoUrl || '').trim()
  if (!/^https?:\/\//i.test(url)) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > 32 ? buf : null
  } catch {
    return null
  }
}

function customerSummaryRows(finance) {
  const serviceAmount = Number(finance.serviceAmount) || 0
  const convenienceFee = Number(finance.convenienceFee) || 0
  const serviceLabel = String(finance.serviceName || 'Service').trim() || 'Service'
  const total = serviceAmount + convenienceFee
  return commercialInvoiceTableRows({
    lines: [
      serviceAmount > 0 ? { label: serviceLabel, amount: serviceAmount } : null,
      convenienceFee > 0 ? { label: 'Convenience Fee', amount: convenienceFee } : null,
    ].filter(Boolean),
    subtotal: total,
    finalAmount: total,
  })
}

function drawHLine(doc, x1, x2, y, width = 0.8, color = RULE) {
  doc
    .moveTo(x1, y)
    .lineTo(x2, y)
    .strokeColor(color)
    .lineWidth(width)
    .stroke()
}

function drawRect(doc, x, y, w, h, width = 0.8) {
  doc.strokeColor(RULE).lineWidth(width).rect(x, y, w, h).stroke()
}

function drawLogoMark(doc, x, y, logoBuffer) {
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, x, y, { fit: [42, 42] })
      return
    } catch {
      /* fall through */
    }
  }
  doc.save()
  doc.rect(x, y, 42, 42).strokeColor(RULE).lineWidth(0.8).stroke()
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(11)
  doc.text('RS', x, y + 15, { width: 42, align: 'center' })
  doc.restore()
}

function companyLines(invoice) {
  return [
    invoice.companyAddress,
    invoice.companyPhone ? `Phone: ${invoice.companyPhone}` : '',
    invoice.companyEmail ? `Email: ${invoice.companyEmail}` : '',
    invoice.udyamNumber ? `Udyam: ${invoice.udyamNumber}` : '',
    invoice.companyWebsite ? `Website: ${invoice.companyWebsite}` : '',
  ].filter(Boolean)
}

function drawPageHeader(doc, invoice, logoBuffer, title, subtitle, margin) {
  const pageWidth = doc.page.width
  const right = pageWidth - margin
  const contentWidth = right - margin

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(14)
  doc.text(title, margin, margin, { width: contentWidth, align: 'center' })
  let y = margin + 18
  if (subtitle) {
    doc.font('Helvetica-Bold').fontSize(10)
    doc.text(subtitle, margin, y, { width: contentWidth, align: 'center' })
    y += 14
  }

  drawHLine(doc, margin, right, y, 1.2)
  y += 10

  drawLogoMark(doc, margin, y, logoBuffer)
  const textX = margin + 52
  const textW = contentWidth - 52
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13)
  doc.text(wrapText(invoice.companyName, 'Repair Series'), textX, y, { width: textW })
  doc.fillColor(MUTED).font('Helvetica').fontSize(8)
  const details = companyLines(invoice).join('\n')
  const detailsH = Math.max(
    42,
    doc.heightOfString(details, { width: textW, lineGap: 1.5 }) + 16,
  )
  doc.text(details, textX, y + 16, { width: textW, lineGap: 1.5 })
  y += detailsH + 6
  drawHLine(doc, margin, right, y, 1.2)
  return y + 10
}

function drawPartyBox(doc, x, y, w, title, rows) {
  const pad = 8
  const labelW = 88
  const valueW = w - pad * 2 - labelW
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8)
  const titleH = 16
  let innerY = y + titleH + 6
  const measured = rows.map(([label, value]) => {
    const text = wrapText(value)
    const h = Math.max(12, doc.heightOfString(text, { width: valueW, lineGap: 1 }) + 4)
    return { label, text, h }
  })
  const bodyH = measured.reduce((sum, row) => sum + row.h, 0)
  const h = titleH + 8 + bodyH + 6
  drawRect(doc, x, y, w, h)
  doc.save()
  doc.rect(x, y, w, titleH).fill(HEADER_FILL)
  doc.restore()
  drawHLine(doc, x, x + w, y + titleH, 0.6)
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8)
  doc.text(title, x + pad, y + 4, { width: w - pad * 2 })
  doc.font('Helvetica').fontSize(8)
  for (const row of measured) {
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5)
    doc.text(row.label, x + pad, innerY, { width: labelW })
    doc.fillColor(INK).font('Helvetica').fontSize(8)
    doc.text(row.text, x + pad + labelW, innerY, { width: valueW, lineGap: 1 })
    innerY += row.h
  }
  return y + h
}

function drawParties(doc, margin, y, contentWidth, leftTitle, leftRows, rightTitle, rightRows) {
  const gap = 10
  const colW = (contentWidth - gap) / 2
  const leftBottom = drawPartyBox(doc, margin, y, colW, leftTitle, leftRows)
  const rightBottom = drawPartyBox(doc, margin + colW + gap, y, colW, rightTitle, rightRows)
  return Math.max(leftBottom, rightBottom) + 10
}

function drawMetaTable(doc, margin, y, contentWidth, cells) {
  const cols = 4
  const colW = contentWidth / cols
  const rowH = 28
  drawRect(doc, margin, y, contentWidth, rowH)
  cells.slice(0, cols).forEach((cell, i) => {
    const x = margin + i * colW
    if (i > 0) {
      doc
        .moveTo(x, y)
        .lineTo(x, y + rowH)
        .strokeColor(RULE)
        .lineWidth(0.6)
        .stroke()
    }
    doc.fillColor(MUTED).font('Helvetica').fontSize(7)
    doc.text(cell.label, x + 6, y + 4, { width: colW - 12 })
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(8)
    doc.text(wrapText(cell.value), x + 6, y + 14, { width: colW - 12 })
  })
  return y + rowH + 10
}

function drawAmountTable(doc, margin, y, contentWidth, rows) {
  const headerH = 18
  const amtW = 130
  const descW = contentWidth - amtW
  doc.save()
  doc.rect(margin, y, contentWidth, headerH).fill(HEADER_FILL)
  doc.restore()
  drawRect(doc, margin, y, contentWidth, headerH)
  doc
    .moveTo(margin + descW, y)
    .lineTo(margin + descW, y + headerH)
    .strokeColor(RULE)
    .lineWidth(0.6)
    .stroke()
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8)
  doc.text('Particular', margin + 8, y + 5, { width: descW - 16 })
  doc.text('Amount', margin + descW + 6, y + 5, { width: amtW - 12, align: 'right' })

  let cy = y + headerH
  rows.forEach((row, idx) => {
    const isTotal = idx === rows.length - 1
    const h = isTotal ? 20 : 16
    if (isTotal) {
      doc.save()
      doc.rect(margin, cy, contentWidth, h).fill(TOTAL_FILL)
      doc.restore()
    }
    drawRect(doc, margin, cy, contentWidth, h, 0.6)
    doc
      .moveTo(margin + descW, cy)
      .lineTo(margin + descW, cy + h)
      .strokeColor(isTotal ? '#FFFFFF' : RULE)
      .lineWidth(0.6)
      .stroke()
    const label = row[0]
    const amount = `₹ ${inr(row[1])}`
    doc.fillColor(isTotal ? '#FFFFFF' : INK).font(isTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(isTotal ? 8.5 : 8)
    doc.text(label, margin + 8, cy + (isTotal ? 5 : 4), { width: descW - 16 })
    doc.text(amount, margin + descW + 6, cy + (isTotal ? 5 : 4), {
      width: amtW - 12,
      align: 'right',
    })
    cy += h
  })
  return cy
}

function drawWordsBox(doc, margin, y, contentWidth, words) {
  const h = 36
  drawRect(doc, margin, y, contentWidth, h)
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5)
  doc.text('Amount in words', margin + 8, y + 5, { width: contentWidth - 16 })
  doc.fillColor(INK).font('Helvetica-Oblique').fontSize(8.5)
  doc.text(wrapText(words, 'Rupees Zero Only'), margin + 8, y + 16, {
    width: contentWidth - 16,
  })
  return y + h
}

function drawSignature(doc, margin, y, pageWidth, companyName, signatureBuffer) {
  const w = 180
  const x = pageWidth - margin - w
  doc.fillColor(MUTED).font('Helvetica').fontSize(8)
  doc.text(`For ${wrapText(companyName, 'Repair Series')}`, x, y, {
    width: w,
    align: 'center',
  })
  let lineY = y + 36
  if (signatureBuffer) {
    try {
      doc.image(signatureBuffer, x + (w - 96) / 2, y + 12, { fit: [96, 40] })
      lineY = y + 56
    } catch {
      /* keep line-only signature */
    }
  }
  drawHLine(doc, x, x + w, lineY, 0.7, RULE_LIGHT)
  doc.fillColor(INK).font('Helvetica').fontSize(8)
  doc.text('Authorized Signatory', x, lineY + 4, { width: w, align: 'center' })
}

function drawFooterNote(doc, invoice, margin) {
  const pageWidth = doc.page.width
  const pageHeight = doc.page.height
  const y = pageHeight - 24
  drawHLine(doc, margin, pageWidth - margin, y, 0.6, RULE_LIGHT)
  doc.fillColor(MUTED).font('Helvetica').fontSize(7)
  const note = [
    'This is a computer-generated invoice.',
    invoice.companyPhone ? `Phone: ${invoice.companyPhone}` : '',
    invoice.companyEmail || '',
  ]
    .filter(Boolean)
    .join('  |  ')
  doc.text(note, margin, y + 5, {
    width: pageWidth - margin * 2,
    align: 'center',
    lineBreak: false,
    height: 10,
  })
}

/**
 * Single-page commercial invoice (never a tax invoice).
 */
async function renderInvoicePdf(invoice) {
  const commercial =
    invoice.commercial && Array.isArray(invoice.commercial.lines)
      ? invoice.commercial
      : buildCommercialInvoice(invoice.booking || invoice)
  const logoBuffer = await loadLogoBuffer(invoice.logoUrl)
  const signatureBuffer = await loadLogoBuffer(
    invoice.signatureUrl || invoice.settings?.signatureUrl,
  )
  const pageCount = 1

  const buffer = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 32, bottom: 36, left: 36, right: 36 },
      info: {
        Title: `INVOICE ${invoice.invoiceNumber || ''}`,
        Author: wrapText(invoice.companyName, 'Repair Series'),
        Subject: 'INVOICE',
      },
    })
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const pageWidth = doc.page.width
    const margin = 36
    const contentWidth = pageWidth - margin * 2
    const customerRows = [
      ['Customer Name', invoice.customerName],
      ['Phone', invoice.customerPhone],
      ['Address', invoice.customerAddress],
    ]
    const companyProviderRows = [
      ['Company', invoice.legalName || invoice.companyName],
      ['Address', invoice.companyAddress],
      ['Phone', invoice.companyPhone],
      ['Email', invoice.companyEmail],
    ]
    const metaCells = [
      { label: 'Invoice No.', value: invoice.invoiceNumber },
      { label: 'Invoice Date', value: invoice.invoiceDate },
      { label: 'Booking ID', value: invoice.bookingCode || invoice.bookingId },
      {
        label: 'Payment',
        value: [invoice.paymentMethod, invoice.paymentStatus].filter(Boolean).join(' · '),
      },
    ]

    let y = drawPageHeader(doc, invoice, logoBuffer, 'INVOICE', '', margin)
    y = drawParties(
      doc,
      margin,
      y,
      contentWidth,
      'CUSTOMER DETAILS',
      customerRows,
      'COMPANY DETAILS',
      companyProviderRows,
    )
    y = drawMetaTable(doc, margin, y, contentWidth, metaCells)
    y = drawAmountTable(
      doc,
      margin,
      y,
      contentWidth,
      commercialInvoiceTableRows(commercial),
    )
    y = drawWordsBox(doc, margin, y + 10, contentWidth, invoice.amountInWords) + 14
    drawSignature(doc, margin, y, pageWidth, invoice.companyName, signatureBuffer)
    drawFooterNote(doc, invoice, margin)
    doc.end()
  })

  buffer.pageCount = pageCount
  return buffer
}

module.exports = {
  renderInvoicePdf,
  customerSummaryRows,
  invoiceDocumentTitle,
  commercialInvoiceTableRows,
}
