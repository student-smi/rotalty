import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Business, type Location } from "../lib/api";
import { Alert, Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Spinner } from "../components/ui";
import { BusinessForm, useBusinessContext } from "./business";
import { PlaceFoundCard, PlaceSearch, type PlaceDetails } from "../components/PlaceSearch";

export function SettingsPage() {
  const { business, membership } = useBusinessContext();
  const qc = useQueryClient();
  const canEdit = membership.permissions.includes("business.manage");
  const canLocations = membership.permissions.includes("locations.manage");
  const [picked, setPicked] = useState<PlaceDetails | null>(null);

  return (
    <>
      <PageHeader title="Settings" description="Business profile, branding and locations" />
      <div className="space-y-6">
        {canEdit ? (
          <>
            <LogoCard business={business} />
            <Card title="Business profile">
              <div className="mb-5">
                {picked ? (
                  <PlaceFoundCard place={picked} onClear={() => setPicked(null)} />
                ) : (
                  <PlaceSearch
                    label={business.googlePlaceId ? "Update from Google" : "Fill from Google"}
                    placeholder="Search your shop on Google Maps"
                    onPick={setPicked}
                  />
                )}
              </div>
              <BusinessForm
                key={picked?.placeId ?? "saved"}
                initial={
                  picked
                    ? {
                        ...business,
                        name: picked.name,
                        category: picked.category,
                        phone: picked.phone ?? business.phone,
                        addressLine: picked.addressLine,
                        city: picked.city,
                        state: picked.state,
                        pincode: picked.pincode,
                      }
                    : business
                }
                submitLabel="Save changes"
                onSubmit={async (values) => {
                  const body = picked ? { ...values, googlePlaceId: picked.placeId, latitude: picked.latitude, longitude: picked.longitude } : values;
                  await api(`/api/businesses/${business.id}`, { method: "PATCH", body });
                  await qc.invalidateQueries({ queryKey: ["business", business.id] });
                  await qc.invalidateQueries({ queryKey: ["me"] });
                  if (picked) await qc.invalidateQueries({ queryKey: ["review-settings", business.id] });
                }}
              />
            </Card>
          </>
        ) : (
          <Alert tone="info">Only the business owner can edit the business profile.</Alert>
        )}
        <LocationsCard businessId={business.id} canManage={canLocations} />
      </div>
    </>
  );
}

function LogoCard({ business }: { business: Business }) {
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
    <Card title="Logo" description="Shown on loyalty cards and your customer page. PNG, JPEG or WebP — we resize it automatically.">
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
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </Card>
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
        <div className="flex justify-center py-6 text-zinc-400"><Spinner /></div>
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
