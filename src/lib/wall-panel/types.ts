export const WALL_PANEL_STATUSES = [
  "CONSULTATION_PENDING",
  "ASSIGNED",
  "ARRIVAL_OTP_PENDING",
  "CONSULTATION_IN_PROGRESS",
  "QUOTATION_DRAFT",
  "QUOTATION_PENDING_CUSTOMER",
  "QUOTATION_REJECTED",
  "QUOTATION_ACCEPTED",
  "DELIVERY_IN_PROGRESS",
  "DELIVERY_OTP_PENDING",
  "COMPLETED",
  "CANCELLED",
] as const;

export type WallPanelStatus = (typeof WALL_PANEL_STATUSES)[number];

export type WallPanelAddress = {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  pincode: string;
  lat?: number | null;
  lng?: number | null;
  fullAddress?: string;
};

export type WallPanelQuotationLine = {
  designId: string;
  designName?: string;
  widthCm?: number;
  heightCm?: number;
  quantity: number;
  unitPriceRupees?: number;
  lineTotalRupees?: number;
};

export type WallPanelBooking = {
  bookingCode: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  address: WallPanelAddress;
  scheduledDate: string;
  scheduledSlotLabel: string;
  scheduledSlotIndex?: number;
  interestedDesignIds: string[];
  customerNotes?: string;
  status: WallPanelStatus;
  assignedEmployeeId?: string | null;
  assignedEmployeeName?: string | null;
  consultationOtp?: string | null;
  consultationOtpExpiresAt?: unknown;
  consultationOtpVerifiedAt?: unknown;
  arrivalMarkedAt?: unknown;
  quotation?: {
    lines: WallPanelQuotationLine[];
    totalRupees: number;
    notes?: string;
    submittedAt?: unknown;
    customerRespondedAt?: unknown;
    customerDecision?: "ACCEPT" | "REJECT";
  };
  deliveryOtp?: string | null;
  deliveryOtpExpiresAt?: unknown;
  deliveryOtpVerifiedAt?: unknown;
  deliveryMarkedAt?: unknown;
  completedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};
