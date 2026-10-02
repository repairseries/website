function money(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100) / 100
}

function invoiceServiceAmount(booking) {
  const b = booking || {}
  for (const key of ['serviceSubtotal', 'serviceAmount', 'servicePrice', 'originalBookingAmount']) {
    const n = money(b[key])
    if (n > 0) return n
  }
  return money(b.amount ?? b.baseAmount)
}

function convenienceFeeAmount(booking) {
  const b = booking || {}
  return money(
    b.customerConvenienceFee ?? b.convenienceFee ?? b.quotedConvenienceFee,
  )
}

function invoiceServiceLabel(booking) {
  const b = booking || {}
  const name = String(b.serviceName ?? b.serviceTitle ?? b.name ?? '').trim()
  return name || 'Service'
}

/**
 * Single company invoice (not a tax invoice, not a partner invoice).
 * Total = Service + Convenience Fee. GST / spare / extra / visiting ignored.
 */
function buildCommercialInvoice(booking) {
  const serviceAmount = invoiceServiceAmount(booking)
  const convenienceFee = convenienceFeeAmount(booking)
  const serviceLabel = invoiceServiceLabel(booking)
  const lines = []
  if (serviceAmount > 0) lines.push({ label: serviceLabel, amount: serviceAmount })
  if (convenienceFee > 0) lines.push({ label: 'Convenience Fee', amount: convenienceFee })
  const finalAmount = money(serviceAmount + convenienceFee)
  return {
    serviceAmount,
    sparePartValue: 0,
    extraServiceAmount: 0,
    convenienceFee,
    gstAmount: 0,
    gstPercent: 0,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: 0,
    lines,
    subtotal: finalAmount,
    finalAmount,
    invoicePageCount: 1,
  }
}

function commercialInvoiceTableRows(commercial) {
  const inv = commercial || buildCommercialInvoice({})
  const rows = (inv.lines || []).map((line) => [line.label, money(line.amount)])
  rows.push(['Total Amount', money(inv.finalAmount)])
  return rows
}

function invoiceDocumentTitle() {
  return 'INVOICE'
}

module.exports = {
  money,
  buildCommercialInvoice,
  commercialInvoiceTableRows,
  invoiceDocumentTitle,
}
