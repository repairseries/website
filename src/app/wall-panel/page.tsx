"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Container } from "@/components/container";

type Design = {
  id: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  features?: string[];
  images?: Array<{ url?: string; isCover?: boolean }>;
};

function photosOf(design: Design) {
  const urls = (design.images || []).map((img) => img.url).filter(Boolean) as string[];
  if (!urls.length && design.imageUrl) urls.push(design.imageUrl);
  return urls;
}

export default function WallPanelPage() {
  const [designs, setDesigns] = useState<Design[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/wall-panel/designs");
        const json = (await res.json()) as { designs?: Design[]; error?: string };
        if (!res.ok) throw new Error(json.error || "Failed to load designs");
        setDesigns(json.designs || []);
      } catch (e) {
        setError((e as Error).message || "Failed");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="bg-[#F8F6F4]">
      <section className="relative overflow-hidden bg-[#1A1A1A] text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,#C45508_0%,transparent_42%)] opacity-80" />
        <Container className="relative grid gap-8 py-16 md:grid-cols-2 md:py-24">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#F3C7A8]">
              Interior · Wall Panel
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight md:text-5xl">
              Design your walls with a home consultation.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-7 text-white/75">
              Explore finishes, book a visit, and approve a quotation before anything is delivered.
              Consultation booking itself does not charge a panel price.
            </p>
            <Link
              href="/wall-panel/book"
              className="mt-8 inline-flex rounded-full bg-[#C45508] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#a34706]"
            >
              Book consultation
            </Link>
          </div>
          <div className="hidden overflow-hidden rounded-3xl md:block">
            {designs[0] && photosOf(designs[0]).length ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photosOf(designs[0])[0]} alt="" className="h-full min-h-[280px] w-full object-cover" />
            ) : (
              <div className="min-h-[280px] bg-gradient-to-br from-[#C45508] to-[#1A1A1A]" />
            )}
          </div>
        </Container>
      </section>

      <Container className="py-12">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-neutral-900">Available designs</h2>
            <p className="mt-1 text-sm text-neutral-500">Select a look, then book a consultation.</p>
          </div>
        </div>

        {loading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-72 animate-pulse rounded-3xl bg-white" />
            ))}
          </div>
        ) : null}

        {error ? <p className="rounded-2xl bg-white p-6 text-sm text-red-600">{error}</p> : null}

        {!loading && !error && designs.length === 0 ? (
          <div className="rounded-3xl border border-dashed bg-white p-10 text-center">
            <p className="font-semibold text-neutral-900">No designs published yet</p>
            <p className="mt-2 text-sm text-neutral-500">
              Add designs in the Admin Panel under Wall Panel, then refresh this page.
            </p>
          </div>
        ) : null}

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {designs.map((d) => {
            const photos = photosOf(d);
            return (
            <article
              key={d.id}
              className="group overflow-hidden rounded-3xl border border-black/5 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="flex gap-2 overflow-x-auto p-2">
                {photos.length ? photos.map((url) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={url} src={url} alt={d.name || "Wall panel design"} className="h-56 w-full min-w-full rounded-2xl object-cover" />
                )) : <div className="h-56 w-full rounded-2xl bg-neutral-100" />}
              </div>
              <div className="p-5">
                <h3 className="text-lg font-semibold text-neutral-900">{d.name || "Design"}</h3>
                <p className="mt-1 text-xs text-neutral-500">{photos.length} photos</p>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-neutral-600">{d.description}</p>
                <Link
                  href={`/wall-panel/book?design=${encodeURIComponent(d.id)}`}
                  className="mt-4 inline-block text-sm font-semibold text-[#C45508]"
                >
                  Select this design
                </Link>
              </div>
            </article>
            );
          })}
        </div>
      </Container>
    </div>
  );
}
