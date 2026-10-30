"use client";

import { collection, getDocs, query, where } from "firebase/firestore";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getDb } from "@/lib/firebase/firestore";
import {
  resolveCategoryByPath,
  resolveServiceByPath,
  resolveServiceCategoryByPath,
  resolveServiceTypeByPath,
} from "@/lib/catalog/resolve";
import { catalogImage, catalogTitle, isCatalogActive, sortByDisplayOrder } from "@/lib/catalog/hierarchy";
import { getHierarchyPath, getServicePath } from "@/lib/catalog/slug";
import { isWallPanelCatalogItem } from "@/lib/catalog/wallPanel";
import { RemoteImage as Image } from "@/components/remote-image";

type Named = { id: string; title?: string; name?: string; slug?: string; image?: string; imageUrl?: string; icon?: string; serviceTypeId?: string; categoryId?: string; status?: string; active?: boolean };

export function CatalogTree({ segments }: { segments: string[] }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [crumbs, setCrumbs] = useState<Named[]>([]);
  const [children, setChildren] = useState<Named[]>([]);
  const [childHref, setChildHref] = useState<"type" | "category" | "issue" | "service">("type");

  const segs = useMemo(() => segments.filter(Boolean), [segments]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      const db = getDb();
      if (!db) {
        setError("Firebase is not configured.");
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError(null);
        if (segs.length === 0) {
          const snap = await getDocs(collection(db, "serviceTypes"));
          const rows = sortByDisplayOrder(
            snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Named).filter(isCatalogActive),
          );
          if (!mounted) return;
          setCrumbs([]);
          setChildren(rows);
          setChildHref("type");
          return;
        }
        const type = await resolveServiceTypeByPath(db, segs[0]);
        if (!type) {
          setError("Not found");
          return;
        }
        const trail: Named[] = [type as Named];
        if (segs.length === 1) {
          if (isWallPanelCatalogItem(type as Named)) {
            window.location.replace("/wall-panel");
            return;
          }
          const snap = await getDocs(query(collection(db, "categories"), where("serviceTypeId", "==", type.id)));
          const rows = sortByDisplayOrder(
            snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Named).filter(isCatalogActive),
          );
          if (!mounted) return;
          setCrumbs(trail);
          setChildren(rows);
          setChildHref("category");
          return;
        }
        const category = await resolveCategoryByPath(db, segs[1]);
        if (!category) {
          setError("Not found");
          return;
        }
        trail.push(category as Named);
        if (segs.length === 2) {
          const snap = await getDocs(query(collection(db, "serviceCategories"), where("categoryId", "==", category.id)));
          const rows = sortByDisplayOrder(
            snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Named).filter(isCatalogActive),
          );
          if (!mounted) return;
          setCrumbs(trail);
          setChildren(rows);
          setChildHref("issue");
          return;
        }
        const issue = await resolveServiceCategoryByPath(db, segs[2]);
        if (!issue) {
          setError("Not found");
          return;
        }
        trail.push(issue as Named);
        if (segs.length === 3) {
          const snap = await getDocs(
            query(collection(db, "services"), where("serviceCategoryId", "==", issue.id), where("status", "==", "Active")),
          );
          const rows = sortByDisplayOrder(
            snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Named),
          );
          if (!mounted) return;
          setCrumbs(trail);
          setChildren(rows);
          setChildHref("service");
          return;
        }
        const service = await resolveServiceByPath(db, segs[3]);
        if (!mounted) return;
        if (service) {
          window.location.replace(getServicePath(service as { id: string; slug?: string; name?: string; title?: string; status?: string }));
        } else {
          setError("Not found");
        }
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Failed to load catalog");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [segs]);

  const hrefFor = (item: Named) => {
    if (isWallPanelCatalogItem(item)) return "/wall-panel";
    if (childHref === "type") return getHierarchyPath([item]);
    if (childHref === "category") return getHierarchyPath([crumbs[0], item]);
    if (childHref === "issue") return getHierarchyPath([crumbs[0], crumbs[1], item]);
    return getServicePath(item);
  };

  if (loading) return <p className="py-12 text-muted-foreground">Loading…</p>;
  if (error) return <p className="py-12 text-destructive">{error}</p>;

  return (
    <div className="space-y-6">
      {crumbs.length ? (
        <nav className="text-sm text-muted-foreground">
          <Link href="/">Home</Link>
          {crumbs.map((c, i) => (
            <span key={c.id}>
              {" / "}
              <Link href={getHierarchyPath(crumbs.slice(0, i + 1))}>{catalogTitle(c)}</Link>
            </span>
          ))}
        </nav>
      ) : null}
      <h1 className="text-3xl font-semibold">
        {crumbs.length ? catalogTitle(crumbs[crumbs.length - 1]) : "What do you need?"}
      </h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {children.map((item) => {
          const img = catalogImage(item);
          return (
            <Link key={item.id} href={hrefFor(item)} className="overflow-hidden rounded-2xl border bg-card">
              {img ? (
                <Image src={img} alt="" className="h-40 w-full object-cover" />
              ) : (
                <div className="h-24 bg-muted" />
              )}
              <div className="p-4 font-medium">{catalogTitle(item)}</div>
            </Link>
          );
        })}
      </div>
      {!children.length ? <p className="text-muted-foreground">Nothing to show yet.</p> : null}
    </div>
  );
}
