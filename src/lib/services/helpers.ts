import type { Firestore } from "firebase/firestore";
import type { ServiceDoc } from "@/lib/booking/types";
import { resolveServiceByPath } from "@/lib/catalog/resolve";

export function getServiceName(s: ServiceDoc) {
  return s.name ?? s.title ?? "Service";
}

export function getServiceImage(s: ServiceDoc) {
  return s.imageUrl ?? s.image ?? null;
}

export {
  getServicePrice,
  getActiveVariations,
  getServicePriceDisplay,
  getSelectedVariationPrice,
  serviceHasVariations,
  normalizeVariation,
} from "@/lib/services/pricing";

export function getVisitingCharge(_s: ServiceDoc): number {
  return 0;
}

export async function loadService(
  db: Firestore,
  serviceIdOrSlug: string,
): Promise<ServiceDoc | null> {
  const row = await resolveServiceByPath(db, serviceIdOrSlug);
  if (!row) return null;
  const service = row as ServiceDoc;
  try {
    const { collection, getDocs, query, where } = await import("firebase/firestore");
    const snap = await getDocs(query(collection(db, "variations"), where("serviceId", "==", service.id)));
    if (!snap.empty) {
      service.variations = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as ServiceDoc["variations"];
      service.hasVariations = true;
    }
  } catch {
    /* keep embedded */
  }
  return service;
}
