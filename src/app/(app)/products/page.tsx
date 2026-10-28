import { PageHeader } from "@/components/app/page-header";
import { ProductCard } from "@/components/products/product-card";
import { requireBusiness } from "@/lib/auth/guards";
import { listProductsForBusiness } from "@/services/products";

export const metadata = { title: "Products" };

export default async function ProductsPage() {
  const { supabase, business } = await requireBusiness();
  const products = await listProductsForBusiness(supabase, business.id);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Products"
        description={`Switch on the AI products you want to run for ${business.name}, then fine-tune how they behave.`}
      />
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {products.map((product) => (
          <ProductCard key={product.key} product={product} />
        ))}
      </div>
    </div>
  );
}
