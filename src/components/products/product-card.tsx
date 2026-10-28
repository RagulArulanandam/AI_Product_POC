import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProductView } from "@/services/products";

export function ProductCard({ product }: { product: ProductView }) {
  const comingSoon = product.status === "coming_soon";

  return (
    <Card data-testid={`product-${product.key}`}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          {product.name}
          {comingSoon ? (
            <Badge variant="outline">Coming soon</Badge>
          ) : product.enabled ? (
            <Badge>On</Badge>
          ) : (
            <Badge variant="secondary">Off</Badge>
          )}
        </CardTitle>
        <CardDescription>{product.description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
