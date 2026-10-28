import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ProductToggle } from "@/components/products/product-toggle";
import { requireBusiness } from "@/lib/auth/guards";
import { parseHours } from "@/products/missed-call/hours";
import type { MissedCallConfig } from "@/products/missed-call/config";
import { MissedCallForm } from "@/products/missed-call/form";
import { getProduct } from "@/products/registry";
import { getIntegrationsOverview } from "@/services/integrations";
import { getProductSettings } from "@/services/products";

export async function generateMetadata(props: PageProps<"/products/[key]">) {
  const { key } = await props.params;
  return { title: getProduct(key)?.name ?? "Product" };
}

export default async function ProductSettingsPage(props: PageProps<"/products/[key]">) {
  const { key } = await props.params;
  const product = getProduct(key);
  if (!product || product.status !== "available") notFound();

  const { supabase, business } = await requireBusiness();
  const [settings, overview] = await Promise.all([getProductSettings(supabase, business.id, key), getIntegrationsOverview(supabase, business.id)]);
  if (!settings) notFound();

  return (
    <div className="space-y-8">
      <Link href="/products" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> All products
      </Link>
      <PageHeader
        title={product.name}
        description={product.description}
        actions={<ProductToggle productKey={key} enabled={settings.enabled} label={product.name} />}
      />
      {key === "missed-call" ? (
        <MissedCallForm
          initial={settings.config as MissedCallConfig}
          businessName={business.name}
          profileHours={parseHours(business.business_hours)}
          timezone={business.timezone}
          calendarStatus={overview.calendar.status}
        />
      ) : null}
    </div>
  );
}
