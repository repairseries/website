import { Container } from "@/components/container";
import { CatalogTree } from "@/app/[...catalog]/catalog-tree";

const RESERVED = new Set([
  "api",
  "cart",
  "services",
  "categories",
  "category",
  "book",
  "dashboard",
  "search",
  "coming-soon",
  "cities",
  "about",
  "contact",
  "terms",
  "privacy-policy",
  "refund",
  "login",
  "catalog",
]);

export default async function CatalogCatchAllPage({
  params,
}: {
  params: Promise<{ catalog: string[] }>;
}) {
  const { catalog } = await params;
  const first = String(catalog?.[0] || "").toLowerCase();
  if (RESERVED.has(first)) {
    return (
      <Container className="py-12">
        <p>Not found.</p>
      </Container>
    );
  }
  return (
    <Container className="py-12">
      <CatalogTree segments={catalog || []} />
    </Container>
  );
}
