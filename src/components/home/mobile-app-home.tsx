"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isWallPanelCatalogItem } from "@/lib/catalog/wallPanel";
import { isCatalogActive, sortByDisplayOrder } from "@/lib/catalog/hierarchy";
import {
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import {
  MapPin,
  ShoppingCart,
  Navigation,
  Pencil,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { DynamicHomeSections } from "@/components/home/dynamic-home-sections";
import { getDb } from "@/lib/firebase/firestore";
import { useLocation } from "@/context/location-context";
import { useAuth } from "@/hooks/use-auth";
import {
  filterHomeSectionsForPlatform,
  filterHomeSectionsForServiceType,
  type HomeBannerDoc,
  type HomeSectionDoc,
} from "@/lib/home-sections/resolve";

type CategoryDoc = {
  id: string;
  name?: string;
  title?: string;
  icon?: string;
  active?: boolean;
  isActive?: boolean;
  serviceTypeId?: string;
  slug?: string;
};

type ServiceDoc = {
  id: string;
  name?: string;
  title?: string;
  slug?: string;
  categoryId?: string;
  serviceTypeId?: string;
  serviceCategoryId?: string;
  status?: string;
  comingSoonCategory?: string;
  price?: number;
  image?: string;
  imageUrl?: string;
};

type SavedAddress = {
  id?: string;
  label?: string;
  type?: string;
  city?: string;
  state?: string;
  pincode?: string;
  street?: string;
  area?: string;
  fullAddress?: string;
  lat?: number;
  lng?: number;
};

/** Phone-width home that mirrors the Repair Series user app shell. */
export function MobileAppHome() {
  const router = useRouter();
  const { customer } = useAuth();
  const { label, loading: locationLoading, refreshFromGps, applySavedAddress } =
    useLocation();
  const [categories, setCategories] = useState<CategoryDoc[]>([]);
  const [services, setServices] = useState<ServiceDoc[]>([]);
  const [comingSoon, setComingSoon] = useState<ServiceDoc[]>([]);
  const [cmsSections, setCmsSections] = useState<HomeSectionDoc[]>([]);
  const [serviceTypes, setServiceTypes] = useState<CategoryDoc[]>([]);
  const [serviceCategories, setServiceCategories] = useState<CategoryDoc[]>([]);
  const [banners, setBanners] = useState<HomeBannerDoc[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [locationOpen, setLocationOpen] = useState(false);
  const [locationError, setLocationError] = useState("");
  const locationRef = useRef<HTMLDivElement>(null);

  const savedAddresses = (Array.isArray(customer?.addresses)
    ? customer.addresses
    : []) as SavedAddress[];

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!locationRef.current?.contains(e.target as Node)) {
        setLocationOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    const db = getDb();
    if (!db) return;
    void getDocs(query(collection(db, "categories"), orderBy("name", "asc"))).then((snap) => {
      setCategories(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as CategoryDoc)
          .filter((c) => c.active !== false && c.isActive !== false),
      );
    });
    void getDocs(collection(db, "serviceTypes")).then((snap) => {
      setServiceTypes(
        sortByDisplayOrder(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as CategoryDoc)
            .filter((row) => isCatalogActive(row)),
        ),
      );
    });
    void getDocs(collection(db, "serviceCategories")).then((snap) => {
      setServiceCategories(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CategoryDoc));
    });
    void getDocs(collection(db, "banners")).then((snap) => {
      setBanners(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as HomeBannerDoc));
    });
    void getDocs(query(collection(db, "services"), orderBy("name", "asc"))).then((snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ServiceDoc);
      setServices(all.filter((s) => String(s.status || "Active") === "Active"));
    });
    const unsubSoon = onSnapshot(
      query(collection(db, "services"), where("status", "==", "Coming Soon")),
      (snap) => {
        setComingSoon(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as ServiceDoc & { previewStatus?: string })
            .filter(
              (s) => String(s.previewStatus ?? "Active") !== "Inactive",
            ),
        );
      },
    );
    const unsubSections = onSnapshot(collection(db, "homeSections"), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as HomeSectionDoc);
      setCmsSections(filterHomeSectionsForPlatform(rows, "mobileWeb"));
    });
    return () => {
      unsubSoon();
      unsubSections();
    };
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("rs.homeServiceTypeId");
      if (saved) setSelectedTypeId(saved);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (selectedTypeId) {
      try {
        window.localStorage.setItem("rs.homeServiceTypeId", selectedTypeId);
      } catch {
        /* ignore */
      }
      return;
    }
    const first = serviceTypes[0]?.id;
    if (first) setSelectedTypeId(first);
  }, [selectedTypeId, serviceTypes]);

  const selectedType = useMemo(
    () => serviceTypes.find((t) => t.id === selectedTypeId) || serviceTypes[0] || null,
    [serviceTypes, selectedTypeId],
  );

  const layoutSections = useMemo(
    () => filterHomeSectionsForServiceType(cmsSections, selectedType?.id),
    [cmsSections, selectedType?.id],
  );

  const scopedCategories = useMemo(
    () =>
      categories.filter(
        (c) =>
          !selectedType?.id ||
          !c.serviceTypeId ||
          String(c.serviceTypeId) === String(selectedType.id),
      ),
    [categories, selectedType?.id],
  );

  const scopedServices = useMemo(
    () =>
      services.filter(
        (s) =>
          !selectedType?.id ||
          !s.serviceTypeId ||
          String(s.serviceTypeId) === String(selectedType.id),
      ),
    [services, selectedType?.id],
  );

  const onDetectLocation = async () => {
    setLocationError("");
    try {
      await refreshFromGps();
      setLocationOpen(false);
    } catch {
      setLocationError("Could not detect location. Try again or change manually.");
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#F8F6F4] pb-4">
      <div className="bg-gradient-to-b from-[#C45508] to-[#E07A35] px-4 pb-4 pt-3 text-white">
        <div className="flex items-center justify-between gap-3">
        <div ref={locationRef} className="relative min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setLocationOpen((v) => !v)}
            className="flex max-w-full items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-left text-xs font-semibold backdrop-blur"
            aria-expanded={locationOpen}
            aria-haspopup="listbox"
          >
            <MapPin className="size-3.5 shrink-0" />
            <span className="truncate">
              {label || "Set your service location"}
            </span>
            <ChevronDown
              className={`size-3.5 shrink-0 opacity-80 transition-transform ${locationOpen ? "rotate-180" : ""}`}
            />
          </button>

          {locationOpen ? (
            <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border border-black/5 bg-white text-[#1A1A1A] shadow-xl">
              <div className="border-b border-gray-100 px-3 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wide text-[#64748b]">
                  Your location
                </div>
                <div className="mt-0.5 truncate text-sm font-semibold">
                  {label || "Not set"}
                </div>
              </div>
              <div className="p-1.5">
                <button
                  type="button"
                  onClick={() => void onDetectLocation()}
                  disabled={locationLoading}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-orange-50 disabled:opacity-60"
                >
                  {locationLoading ? (
                    <Loader2 className="size-4 animate-spin text-[#C45508]" />
                  ) : (
                    <Navigation className="size-4 text-[#C45508]" />
                  )}
                  Detect current location
                </button>
                <Link
                  href="/book"
                  onClick={() => setLocationOpen(false)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-orange-50"
                >
                  <Pencil className="size-4 text-[#C45508]" />
                  Change location
                </Link>
              </div>
              {savedAddresses.length > 0 ? (
                <div className="border-t border-gray-100 p-1.5">
                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-[#64748b]">
                    Saved addresses
                  </div>
                  {savedAddresses.map((addr, idx) => {
                    const addrLabel =
                      String(addr.label ?? addr.type ?? "Address").trim() ||
                      `Address ${idx + 1}`;
                    const sub = [addr.area, addr.city, addr.pincode]
                      .filter(Boolean)
                      .join(", ");
                    return (
                      <button
                        key={addr.id ?? `${addrLabel}-${idx}`}
                        type="button"
                        onClick={() => {
                          applySavedAddress({
                            label: addrLabel,
                            lat: addr.lat,
                            lng: addr.lng,
                            city: addr.city,
                            state: addr.state,
                            pincode: addr.pincode,
                            street: addr.street,
                            area: addr.area,
                            fullAddress: addr.fullAddress,
                          });
                          setLocationOpen(false);
                        }}
                        className="flex w-full flex-col rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-orange-50"
                      >
                        <span className="font-medium">{addrLabel}</span>
                        {sub ? (
                          <span className="truncate text-xs text-[#64748b]">
                            {sub}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {locationError ? (
                <div className="border-t border-gray-100 px-3 py-2 text-xs text-red-600">
                  {locationError}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
          <Link
            href="/cart"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15"
            aria-label="Cart"
          >
            <ShoppingCart className="size-5" />
          </Link>
        </div>
      </div>

      {layoutSections.length ? (
        <DynamicHomeSections
          variant="mobile"
          platform="mobileWeb"
          sections={layoutSections}
          categories={scopedCategories}
          services={scopedServices}
          comingSoon={comingSoon}
          extraCatalog={{ serviceTypes, serviceCategories }}
          selectedServiceTypeId={selectedType?.id || ""}
          selectedServiceTypeName={String(selectedType?.title || selectedType?.name || "")}
          banners={banners}
          onSelectServiceType={(id) => {
            const type = serviceTypes.find((t) => t.id === id);
            if (isWallPanelCatalogItem(type)) {
              router.push("/wall-panel");
              return;
            }
            setSelectedTypeId(id);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      ) : null}
    </div>
  );
}

