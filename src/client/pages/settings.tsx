import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Business, type Location } from "../lib/api";
import { Alert, Badge, Button, Card, EmptyState, Input, ListLoader, Modal, PageHeader, Select, Spinner, Textarea } from "../components/ui";
import { useBusinessContext } from "./business";
import type { Program } from "../lib/loyalty-api";
import { shopLinks } from "../../shared/shop-links";
import { CATEGORY_LABELS } from "../lib/labels";
import { BUSINESS_CATEGORIES, type BusinessCategory } from "../../shared/permissions";
import { LoyaltyCard } from "../components/LoyaltyCard";
import { HowItWorksStrip, JoinButtonPreview, ProgramOffer, ShopContactRow, ShopHeader } from "../components/ShopPage";
import { AdvancedSection, EditorLayout, EditorSection, PhoneFrame, SaveBar, Segmented, sameJson, useUnsavedChangesGuard } from "../components/editor";
import { PlaceFoundCard, PlaceSearch, type PlaceDetails } from "../components/PlaceSearch";

interface ShopForm {
  name: string;
  category: BusinessCategory;
  description: string;
  phone: string;
  email: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  whatsappNumber: string;
  instagramHandle: string;
  websiteUrl: string;
}

const formFrom = (b: Business): ShopForm => ({
  name: b.name,
  category: b.category,
  description: b.description ?? "",
  phone: b.phone ?? "",
  email: b.email ?? "",
  addressLine: b.addressLine ?? "",
  city: b.city ?? "",
  state: b.state ?? "",
  pincode: b.pincode ?? "",
  whatsappNumber: b.whatsappNumber ?? "",
  instagramHandle: b.instagramHandle ?? "",
  websiteUrl: b.websiteUrl ?? "",
});

export function SettingsPage() {
  const { business, membership } = useBusinessContext();
  const canEdit = membership.permissions.includes("business.manage");
  const canLocations = membership.permissions.includes("locations.manage");

  if (!canEdit) {
    return (
      <>
        <PageHeader title="Shop settings" description="Business profile, branding and locations" />
        <div className="space-y-6">
          <Alert tone="info">Only the business owner can edit the business profile.</Alert>
          <LocationsCard businessId={business.id} canManage={canLocations} />
        </div>
      </>
    );
  }
  return <ShopEditor business={business} canLocations={canLocations} />;
}

function ShopEditor({ business, canLocations }: { business: Business; canLocations: boolean }) {
  const qc = useQueryClient();
  const initial = useMemo(() => formFrom(business), [business]);
  const [f, setF] = useState<ShopForm>(initial);
  const [picked, setPicked] = useState<PlaceDetails | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewTab, setPreviewTab] = useState<"page" | "card">("page");
  const dirty = !sameJson(f, initial) || !!picked;
  useUnsavedChangesGuard(dirty && !saving);

  // After a save the business reloads: take the server's values as the new baseline.
  const resync = useRef(false);
  useEffect(() => {
    if (!resync.current) return;
    resync.current = false;
    setF(initial);
  }, [initial]);

  const programs = useQuery({
    queryKey: ["programs", business.id],
    queryFn: () => api<{ programs: Program[] }>(`/api/businesses/${business.id}/programs`),
  });
  const livePrograms = programs.data?.programs.filter((p) => p.status === "active") ?? [];

  const set = <K extends keyof ShopForm>(k: K, v: ShopForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const field = (k: Exclude<keyof ShopForm, "category">) => ({
    value: f[k],
    onChange: (e: { target: { value: string } }) => set(k, e.target.value),
    error: errors[k],
  });

  function applyPlace(p: PlaceDetails) {
    setPicked(p);
    setF((prev) => ({
      ...prev,
      name: p.name,
      category: p.category,
      phone: p.phone ?? prev.phone,
      addressLine: p.addressLine ?? "",
      city: p.city ?? "",
      state: p.state ?? "",
      pincode: p.pincode ?? "",
    }));
  }

  function discard() {
    setF(initial);
    setPicked(null);
    setErrors({});
    setError(null);
  }

  async function save() {
    setSaving(true);
    setErrors({});
    setError(null);
    const body = {
      ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])),
      ...(picked ? { googlePlaceId: picked.placeId, latitude: picked.latitude, longitude: picked.longitude } : {}),
    };
    try {
      await api(`/api/businesses/${business.id}`, { method: "PATCH", body });
      resync.current = true;
      const usedPlace = !!picked;
      setPicked(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["business", business.id] }),
        qc.invalidateQueries({ queryKey: ["me"] }),
        usedPlace ? qc.invalidateQueries({ queryKey: ["review-settings", business.id] }) : null,
      ]);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setError(Object.keys(err.fieldErrors()).length ? "Please fix the highlighted fields." : err.message);
      } else setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const shop = { name: f.name, logoUrl: business.logoUrl, addressLine: f.addressLine, city: f.city, description: f.description };
  const links = shopLinks({
    name: f.name,
    phone: f.phone.trim() || null,
    whatsappNumber: f.whatsappNumber.trim() || null,
    instagramHandle: f.instagramHandle.trim().replace(/^.*instagram\.com\//i, "").replace(/^@/, "").replace(/\/+$/, "") || null,
    websiteUrl: f.websiteUrl.trim() ? (/^https?:\/\//i.test(f.websiteUrl.trim()) ? f.websiteUrl.trim() : `https://${f.websiteUrl.trim()}`) : null,
    googlePlaceId: picked?.placeId ?? business.googlePlaceId,
    latitude: business.latitude,
    longitude: business.longitude,
    addressLine: f.addressLine || null,
    city: f.city || null,
  });
  const first = livePrograms[0];
  const preview = (
    <>
      <PhoneFrame>
        {previewTab === "page" ? (
          <div className="pt-2">
            <ShopHeader shop={shop} />
            <HowItWorksStrip />
            <div className="mt-5 space-y-4">
              {livePrograms.length ? (
                livePrograms.map((p) => <ProgramOffer key={p.id} program={{ ...p, rewards: p.rewards.filter((r) => r.isActive) }} action={<JoinButtonPreview />} />)
              ) : (
                <div className="rounded-2xl border-2 border-dashed border-zinc-300 p-5 text-center text-sm text-zinc-500">Your stamp card will appear here.</div>
              )}
            </div>
            <ShopContactRow name={f.name || "your shop"} links={links} preview />
          </div>
        ) : (
          <div className="pt-2">
            <p className="mb-3 text-sm font-semibold text-zinc-500">My loyalty cards</p>
            <LoyaltyCard
              businessName={f.name || "Your shop"}
              logoUrl={business.logoUrl}
              programName={first?.name ?? "Loyalty card"}
              customerName="Riya Shah"
              stampIcon={first?.stampIcon ?? "star"}
              stampsRequired={first?.stampsRequired ?? 10}
              points={3}
              rewards={first?.rewards.filter((r) => r.isActive) ?? []}
            />
          </div>
        )}
      </PhoneFrame>
      <Segmented
        label="Preview screen"
        value={previewTab}
        onChange={setPreviewTab}
        options={[
          { value: "page", label: "Shop page (after QR scan)" },
          { value: "card", label: "Customer's card" },
        ]}
      />
    </>
  );

  return (
    <EditorLayout
      title="Shop settings"
      subtitle="This is what customers see when they scan your QR. Changes appear on the right as you type."
      preview={preview}
      footer={<SaveBar dirty={dirty} saving={saving} saved={saved && !dirty} onSave={save} onDiscard={discard} error={error ?? undefined} />}
    >
      <EditorSection n={1} title="Find your shop on Google" hint="Fills in your name and address. You can still change anything.">
        {picked ? (
          <PlaceFoundCard place={picked} onClear={discard} />
        ) : (
          <PlaceSearch label={business.googlePlaceId ? "Update from Google" : "Search on Google Maps"} placeholder="Type your shop name and area" onPick={applyPlace} />
        )}
      </EditorSection>

      <EditorSection n={2} title="Logo" hint="Shown on every customer's card. Saved as soon as you upload it.">
        <LogoUploader business={business} />
      </EditorSection>

      <EditorSection n={3} title="Shop details">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Shop name" required minLength={2} maxLength={80} {...field("name")} />
            <Select label="Category" value={f.category} onChange={(e) => set("category", e.target.value as BusinessCategory)} error={errors.category}>
              {BUSINESS_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </div>
          <Textarea
            label="Short description (optional)"
            rows={2}
            maxLength={500}
            placeholder="e.g. Fresh masala chai and snacks since 1998, opposite the bus stand."
            hint="Shown under your name on the shop page"
            {...field("description")}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Mobile number" type="tel" inputMode="tel" placeholder="98765 43210" {...field("phone")} />
            <Input label="Email (optional)" type="email" {...field("email")} />
          </div>
        </div>
      </EditorSection>

      <EditorSection n={4} title="Address" hint="Helps customers find you.">
        <div className="space-y-4">
          <Input label="Address" maxLength={200} {...field("addressLine")} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="City" {...field("city")} />
            <Input label="State" {...field("state")} />
            <Input label="PIN code" inputMode="numeric" maxLength={6} {...field("pincode")} />
          </div>
        </div>
      </EditorSection>

      <EditorSection n={5} title="WhatsApp, Instagram & website" hint="Shown as buttons on every customer's card. Leave empty to hide a button.">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="WhatsApp number"
              type="tel"
              inputMode="tel"
              placeholder={f.phone || "98765 43210"}
              hint={f.phone ? "Leave empty to use your mobile number" : undefined}
              {...field("whatsappNumber")}
            />
            <Input label="Instagram username" placeholder="e.g. chai_point" hint="Or paste your profile link" {...field("instagramHandle")} />
          </div>
          <Input label="Website (optional)" placeholder="e.g. chaipoint.in" {...field("websiteUrl")} />
          <p className="text-xs text-zinc-500">📍 Directions are added automatically from your Google listing or address. 📞 Call uses your mobile number.</p>
        </div>
      </EditorSection>

      <AdvancedSection title="Branches / locations" hint="For shops with more than one outlet">
        <LocationsCard businessId={business.id} canManage={canLocations} />
      </AdvancedSection>
    </EditorLayout>
  );
}

function LogoUploader({ business }: { business: Business }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.set("logo", file);
      return api<{ logoUrl: string }>(`/api/businesses/${business.id}/logo`, { form });
    },
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["business", business.id] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Upload failed"),
  });

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setError("Choose a PNG, JPEG or WebP image");
    if (file.size > 10 * 1024 * 1024) return setError("That image is too large (max 10 MB)");
    try {
      upload.mutate(await resizeLogo(file));
    } catch {
      setError("Couldn't read that image. Try a different file.");
    }
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        <div className="flex size-20 items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
          {upload.isPending ? (
            <Spinner />
          ) : business.logoUrl ? (
            <img src={business.logoUrl} alt="Business logo" className="size-full object-cover" />
          ) : (
            <span className="text-2xl font-semibold text-zinc-400">{business.name[0]}</span>
          )}
        </div>
        <div className="space-y-2">
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
          <Button variant="secondary" onClick={() => inputRef.current?.click()} loading={upload.isPending}>
            {business.logoUrl ? "Replace logo" : "Upload logo"}
          </Button>
          <p className="text-xs text-zinc-500">PNG, JPEG or WebP. We resize it automatically.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}

/** Logos are stored in the database, so downscale to 512px and re-encode to stay well under the 300 KB server limit. */
async function resizeLogo(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const type = file.type === "image/jpeg" ? "image/jpeg" : "image/webp";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.86));
  if (!blob) throw new Error("encode failed");
  return new File([blob], `logo.${type === "image/jpeg" ? "jpg" : "webp"}`, { type });
}

function LocationsCard({ businessId, canManage }: { businessId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const key = ["locations", businessId];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api<{ locations: Location[] }>(`/api/businesses/${businessId}/locations`) });
  const [editing, setEditing] = useState<Location | "new" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/businesses/${businessId}/locations/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => setActionError(e instanceof ApiError ? e.message : "Could not delete location"),
  });

  return (
    <Card
      title="Locations"
      description="Outlets where customers collect points"
      actions={canManage && <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>Add location</Button>}
    >
      {actionError && <div className="mb-3"><Alert>{actionError}</Alert></div>}
      {isLoading ? (
        <ListLoader />
      ) : error ? (
        <Alert>Could not load locations</Alert>
      ) : !data?.locations.length ? (
        <EmptyState title="No locations yet" />
      ) : (
        <ul className="divide-y divide-zinc-100">
          {data.locations.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {l.name} {!l.isActive && <Badge>Inactive</Badge>}
                </p>
                <p className="truncate text-sm text-zinc-500">{[l.addressLine, l.city, l.pincode].filter(Boolean).join(", ") || "No address"}</p>
              </div>
              {canManage && (
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(l)}>Edit</Button>
                  {data.locations.length > 1 && (
                    <Button
                      size="sm"
                      variant="danger"
                      loading={remove.isPending && remove.variables === l.id}
                      onClick={() => { if (confirm(`Delete "${l.name}"?`)) { setActionError(null); remove.mutate(l.id); } }}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add location" : "Edit location"}>
        {editing !== null && (
          <LocationForm
            businessId={businessId}
            location={editing === "new" ? null : editing}
            onDone={() => { setEditing(null); qc.invalidateQueries({ queryKey: key }); }}
          />
        )}
      </Modal>
    </Card>
  );
}

function LocationForm({ businessId, location, onDone }: { businessId: string; location: Location | null; onDone: () => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      name: String(f.get("name")).trim(),
      addressLine: String(f.get("addressLine")).trim(),
      city: String(f.get("city")).trim(),
      state: String(f.get("state")).trim(),
      pincode: String(f.get("pincode")).trim(),
      phone: String(f.get("phone")).trim(),
      isActive: f.get("isActive") === "on",
    };
    setLoading(true);
    setErrors({});
    setFormError(null);
    try {
      const base = `/api/businesses/${businessId}/locations`;
      await api(location ? `${base}/${location.id}` : base, { method: location ? "PATCH" : "POST", body });
      onDone();
    } catch (err) {
      if (err instanceof ApiError) { setErrors(err.fieldErrors()); setFormError(err.message); }
      else setFormError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {formError && <Alert>{formError}</Alert>}
      <Input label="Location name" name="name" required minLength={2} maxLength={80} defaultValue={location?.name} error={errors.name} placeholder="e.g. CG Road branch" />
      <Input label="Address" name="addressLine" defaultValue={location?.addressLine ?? ""} error={errors.addressLine} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="City" name="city" defaultValue={location?.city ?? ""} error={errors.city} />
        <Input label="State" name="state" defaultValue={location?.state ?? ""} error={errors.state} />
        <Input label="PIN code" name="pincode" inputMode="numeric" maxLength={6} defaultValue={location?.pincode ?? ""} error={errors.pincode} />
      </div>
      <Input label="Phone" name="phone" type="tel" defaultValue={location?.phone ?? ""} error={errors.phone} />
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input type="checkbox" name="isActive" defaultChecked={location?.isActive ?? true} className="size-4 rounded border-zinc-300 accent-brand-500" />
        Active
      </label>
      <div className="flex justify-end gap-2">
        <Button type="submit" loading={loading}>{location ? "Save" : "Add location"}</Button>
      </div>
    </form>
  );
}
