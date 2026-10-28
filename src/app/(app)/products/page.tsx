import { ProductCard } from "@/components/products/product-card";
import { requireBusiness } from "@/lib/auth/guards";
import { listProductsForBusiness } from "@/services/products";

export default async function ProductsPage() {
  const { supabase, business } = await requireBusiness();
  const products = await listProductsForBusiness(supabase, business.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Products</h1>
        <p className="text-sm text-muted-foreground">AI products you can run for {business.name}.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <ProductCard key={product.key} product={product} />
        ))}
      </div>
    </div>
  );
}
