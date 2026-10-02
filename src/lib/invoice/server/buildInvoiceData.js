const { amountInWords } = require('./amountInWords')
const {
  normalizeInvoiceSettings,
  formatCompanyAddress,
} = require('./defaults')
const { buildCommercialInvoice } = require('./commercialInvoice')

function money(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return 0
  return Math.round(number * 100) / 100
}

function cleanText(value, fallback = '') {
  const text = value != null ? String(value).trim() : ''
  return text || fallback
}

function toDate(value) {
  if (!value) return null
  if (value.toDate && typeof value.toDate === 'function') {
    try {
      return value.toDate()
    } catch {
      return null
    }
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000)
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDateLabel(value) {
  const date = toDate(value)
  if (!date) return ''
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatYmd(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function addressText(value) {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  const full = cleanText(value.fullAddress ?? value.address)
  if (full) return full
  return [
    value.line1,
    value.line2,
    value.landmark,
    value.city,
    value.state,
    value.pincode ?? value.zip,
  ]
    .map((part) => cleanText(part))
    .filter(Boolean)
    .join(', ')
}

function invoiceLine(title, quantity, rate) {
  const safeQuantity = Math.max(1, Math.floor(Number(quantity) || 1))
  const safeRate = money(rate)
  return {
    title: cleanText(title, 'Service'),
    quantity: safeQuantity,
    rate: safeRate,
    amount: money(safeQuantity * safeRate),
  }
}

function mapServiceLines(items, fallbackTitle) {
  if (!Array.isArray(items)) return []
  return items.map((raw) => {
    const item = raw && typeof raw === 'object' ? raw : {}
    return invoiceLine(
      item.title ?? item.serviceName ?? item.name ?? fallbackTitle,
      item.quantity,
      item.price ?? item.rate ?? item.amount,
    )
  })
}

function payableFromBooking(booking) {
  const stored = money(
    booking.finalBookingAmount ?? booking.totalAmount ?? booking.payableAmount,
  )
  if (stored > 0) return stored
  const base = money(booking.amount ?? booking.baseAmount ?? booking.serviceAmount)
  const visiting = money(booking.visitingCharge)
  const addOns = mapServiceLines(booking.addOnServices, 'Add-on')
  const additional = mapServiceLines(booking.additionalServices, 'Additional service')
  const extras = [...addOns, ...additional].reduce((sum, line) => sum + line.amount, 0)
  return money(base + visiting + extras)
}

function buildLines(booking) {
  return buildCommercialInvoice(booking).lines.map((line) =>
    invoiceLine(line.label, 1, line.amount),
  )
}

function paymentMethodLabel(method) {
  const key = cleanText(method).toLowerCase()
  if (!key) return 'Cash / UPI / Card'
  if (key === 'rs_app') return 'RS App'
  if (key === 'upi') return 'UPI'
  if (key === 'qr') return 'QR / UPI'
  if (key === 'cash') return 'Cash'
  if (key === 'card') return 'Card'
  if (key === 'free' || key === 'free_revisit') return 'Free / Revisit'
  return cleanText(method)
}

/**
 * Builds a commercial invoice payload (not a tax invoice).
 * Final amount = Service + Convenience Fee.
 */
function buildInvoiceData({ booking, bookingId, settingsRaw, forceInvoiceNumber }) {
  const settings = normalizeInvoiceSettings(settingsRaw || {})
  const commercial = buildCommercialInvoice(booking)
  const lines = buildLines(booking)
  const grandTotal = commercial.finalAmount
  const subtotal = commercial.subtotal
  const discount = 0

  const bookingCode = cleanText(booking.bookingCode)
  const now = new Date()
  const ymd = formatYmd(now)
  const shortId = bookingId.slice(-8).toUpperCase()
  const invoiceNumber =
    cleanText(forceInvoiceNumber) ||
    `${settings.invoicePrefix}-${ymd}-${shortId}`
  const fileName = `INV-${ymd}-${bookingId}.pdf`
  const folder = `repair-series/invoices/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`

  const paymentStatus = cleanText(booking.paymentStatus).toLowerCase() || 'paid'
  const isFree =
    booking.isRevisit === true ||
    booking.revisit === true ||
    paymentStatus === 'free' ||
    grandTotal === 0

  return {
    invoiceId: `inv_${bookingId}`,
    invoiceNumber,
    fileName,
    folder,
    publicId: `${folder}/${fileName.replace(/\.pdf$/i, '')}`,
    bookingId,
    bookingCode,
    customerId: cleanText(booking.customerId),
    technicianId: cleanText(booking.technicianId),
    customerName: cleanText(booking.customerName, 'Customer'),
    customerPhone: cleanText(booking.customerPhone ?? booking.phone),
    customerEmail: cleanText(booking.customerEmail),
    customerAddress: addressText(booking.address ?? booking.location),
    serviceName: cleanText(booking.serviceName, 'Service'),
    technicianName: cleanText(
      booking.technicianName ?? booking.technician?.name,
    ),
    bookingDate: formatDateLabel(booking.createdAt ?? booking.bookingDate),
    serviceDate: formatDateLabel(
      booking.completedAt ?? booking.serviceCompletedAt ?? booking.scheduledAt,
    ),
    invoiceDate: formatDateLabel(now),
    paymentDate: formatDateLabel(booking.paidAt ?? booking.completedAt ?? now),
    paymentMethod: paymentMethodLabel(
      booking.paymentMethod || (isFree ? 'free_revisit' : ''),
    ),
    paymentStatus: isFree ? 'Free' : paymentStatus === 'paid' ? 'Paid' : paymentStatus === 'pending' ? 'Pending' : (paymentStatus || 'Paid'),
    paymentId: cleanText(
      booking.paymentId ??
        booking.razorpayPaymentId ??
        booking.txnId ??
        booking.transactionId,
    ),
    commercial,
    lines,
    subtotal: money(subtotal),
    discount: money(discount),
    gstPercent: 0,
    gstAmount: 0,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: 0,
    grandTotal: money(grandTotal),
    amountInWords: amountInWords(grandTotal),
    currency: 'INR',
    isRevisit: booking.isRevisit === true || booking.revisit === true,
    status: 'issued',
    source: 'cloud_function',
    companyName: settings.companyName,
    companyAddress: formatCompanyAddress(settings),
    companyPhone: settings.phone,
    companyEmail: settings.email,
    gstin: settings.gstin,
    upiId: settings.upiId,
    terms: settings.terms,
    thankYouMessage: settings.thankYouMessage,
    logoUrl: settings.logoUrl,
    signatureUrl: settings.signatureUrl,
    settings,
  }
}

function shouldGenerateInvoice(booking) {
  const status = cleanText(booking?.status).toLowerCase()
  if (status !== 'completed') return false
  const paymentStatus = cleanText(booking?.paymentStatus).toLowerCase()
  if (paymentStatus === 'paid' || paymentStatus === 'free') return true
  const total = payableFromBooking(booking || {})
  if (
    (booking?.isRevisit === true || booking?.revisit === true) &&
    total === 0
  ) {
    return true
  }
  return total === 0
}

function becameEligibleForInvoice(before, after) {
  if (!shouldGenerateInvoice(after)) return false
  if (!before) return true
  return !shouldGenerateInvoice(before)
}

module.exports = {
  buildInvoiceData,
  shouldGenerateInvoice,
  becameEligibleForInvoice,
  money,
  cleanText,
  formatYmd,
  paymentMethodLabel,
}
