function money(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100) / 100
}

function invoiceServiceAmount(booking) {
  const b = booking || {}
  const snap = b.approvalPriceSnapshot
  if (snap && money(snap.serviceAmount) > 0) return money(snap.serviceAmount)
  for (const key of ['serviceSubtotal', 'serviceAmount', 'servicePrice', 'originalBookingAmount']) {
    const n = money(b[key])
    if (n > 0) return n
  }
  return money(b.amount ?? b.baseAmount)
}

function convenienceFeeAmount(booking) {
  const b = booking || {}
  const snap = b.approvalPriceSnapshot
  if (snap && snap.convenienceFee != null) return money(snap.convenienceFee)
  return money(
    b.originalConvenienceFee ??
      b.customerConvenienceFee ??
      b.convenienceFee ??
      b.quotedConvenienceFee,
  )
}

function visitingChargeAmount(booking) {
  const b = booking || {}
  const snap = b.approvalPriceSnapshot
  if (snap && snap.visitingCharge != null) return money(snap.visitingCharge)
  return 0
}

function lockedCustomerTotal(booking) {
  const b = booking || {}
  const snap = b.approvalPriceSnapshot
  if (snap && money(snap.customerTotal) > 0) return money(snap.customerTotal)
  return money(b.originalCustomerTotal ?? b.quotedFinalAmount)
}

function invoiceServiceLabel(booking) {
  const b = booking || {}
  const name = String(b.serviceName ?? b.serviceTitle ?? b.name ?? '').trim()
  return name || 'Service'
}

function extraServiceInvoiceLines(booking) {
  const b = booking || {}
  const rows = []
  const pushList = (list) => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const name = String(item.title ?? item.serviceName ?? item.name ?? '').trim() || 'Additional service'
      const unit = money(item.unitPrice ?? item.variationPrice ?? item.price ?? item.amount)
      const qtyRaw = Number(item.quantity)
      const quantity = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.floor(qtyRaw) : 1
      const amount = money(item.lineTotal ?? unit * quantity)
      if (amount <= 0) continue
      rows.push({
        label: quantity > 1 ? `${name} × ${quantity}` : name,
        amount,
      })
    }
  }
  pushList(b.addOnServices)
  pushList(b.additionalServices)
  return rows
}

/**
 * Company invoice: locked original charges + additional/extra lines (qty × unit).
 * GST / spare parts are omitted.
 */
function buildCommercialInvoice(booking) {
  const serviceAmount = invoiceServiceAmount(booking)
  const convenienceFee = convenienceFeeAmount(booking)
  const visitingCharge = visitingChargeAmount(booking)
  const locked = lockedCustomerTotal(booking)
  const serviceLabel = invoiceServiceLabel(booking)
  const extraLines = extraServiceInvoiceLines(booking)
  const extraServiceAmount = money(extraLines.reduce((s, l) => s + l.amount, 0))
  const lines = []
  if (serviceAmount > 0) lines.push({ label: serviceLabel, amount: serviceAmount })
  for (const extra of extraLines) lines.push(extra)
  if (convenienceFee > 0) lines.push({ label: 'Convenience Fee', amount: convenienceFee })
  if (visitingCharge > 0) lines.push({ label: 'Visiting Charge', amount: visitingCharge })
  const computed = money(serviceAmount + convenienceFee + visitingCharge + extraServiceAmount)
  const base = locked > 0 ? locked : money(serviceAmount + convenienceFee + visitingCharge)
  const finalAmount = money(base + extraServiceAmount)
  return {
    serviceAmount,
    sparePartValue: 0,
    extraServiceAmount,
    convenienceFee,
    visitingCharge,
    gstAmount: 0,
    gstPercent: 0,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: 0,
    lines,
    subtotal: finalAmount || computed,
    finalAmount: finalAmount || computed,
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
