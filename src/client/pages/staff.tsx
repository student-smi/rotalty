import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Invitation, type Location, type StaffMember } from "../lib/api";
import { ROLE_LABELS } from "../lib/labels";
import { DEFAULT_ROLE_PERMISSIONS, OWNER_ONLY_PERMISSIONS, PERMISSION_LABELS, PERMISSIONS, type Permission } from "../../shared/permissions";
import { Alert, Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { useBusinessContext } from "./business";

const DELEGABLE = PERMISSIONS.filter((p) => !OWNER_ONLY_PERMISSIONS.includes(p));

export function StaffPage() {
  const { business } = useBusinessContext();
  const qc = useQueryClient();
  const base = `/api/businesses/${business.id}`;
  const staff = useQuery({ queryKey: ["staff", business.id], queryFn: () => api<{ staff: StaffMember[] }>(`${base}/staff`) });
  const invites = useQuery({ queryKey: ["invitations", business.id], queryFn: () => api<{ invitations: Invitation[] }>(`${base}/invitations`) });
  const locations = useQuery({ queryKey: ["locations", business.id], queryFn: () => api<{ locations: Location[] }>(`${base}/locations`) });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [created, setCreated] = useState<{ url: string; emailSent: boolean; email: string } | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["staff", business.id] });
    qc.invalidateQueries({ queryKey: ["invitations", business.id] });
  };

  const revoke = useMutation({
    mutationFn: (id: string) => api(`${base}/invitations/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  const locationName = (id: string | null) => (id ? locations.data?.locations.find((l) => l.id === id)?.name ?? "—" : "All locations");

  return (
    <>
      <PageHeader
        title="Staff"
        description="Invite your team and control what each person can do"
        actions={<Button onClick={() => { setCreated(null); setInviteOpen(true); }}>Invite staff</Button>}
      />
      <div className="space-y-6">
        {created && (
          <Alert tone="success">
            <p className="font-medium">Invitation created for {created.email}.</p>
            <p className="mt-1">
              {created.emailSent ? "We emailed them the link. You can also share it directly:" : "Email isn't configured, so share this link with them directly:"}
            </p>
            <InviteLink url={created.url} businessName={business.name} />
          </Alert>
        )}

        <Card title="Team">
          {staff.isLoading ? (
            <div className="flex justify-center py-6 text-zinc-400"><Spinner /></div>
          ) : staff.error ? (
            <Alert>Could not load your team</Alert>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {staff.data!.staff.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="flex size-9 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold text-zinc-600">{s.name[0]?.toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="truncate text-xs text-zinc-500">{s.email} · {locationName(s.locationId)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={s.role === "owner" ? "brand" : "neutral"}>{ROLE_LABELS[s.role]}</Badge>
                    {s.customPermissions && <Badge>Custom</Badge>}
                    {s.status === "disabled" && <Badge tone="danger">Disabled</Badge>}
                    {s.role !== "owner" && <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Manage</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Pending invitations">
          {invites.isLoading ? (
            <div className="flex justify-center py-6 text-zinc-400"><Spinner /></div>
          ) : !invites.data?.invitations.length ? (
            <EmptyState title="No pending invitations" description="Invite cashiers and managers so they can issue points and redeem rewards." />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {invites.data.invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.email}</p>
                    <p className="text-xs text-zinc-500">{ROLE_LABELS[i.role]} · expires {new Date(i.expiresAt).toLocaleDateString("en-IN")}</p>
                  </div>
                  <Button size="sm" variant="danger" loading={revoke.isPending && revoke.variables === i.id} onClick={() => revoke.mutate(i.id)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite staff">
        <InviteForm
          base={base}
          locations={locations.data?.locations ?? []}
          onDone={(result) => { setInviteOpen(false); setCreated(result); refresh(); }}
        />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `Manage ${editing.name}` : ""}>
        {editing && (
          <EditStaffForm
            base={base}
            member={editing}
            locations={locations.data?.locations ?? []}
            onDone={() => { setEditing(null); refresh(); }}
          />
        )}
      </Modal>
    </>
  );
}

function InviteLink({ url, businessName }: { url: string; businessName: string }) {
  const [copied, setCopied] = useState(false);
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`You're invited to join ${businessName}. Accept here: ${url}`)}`;
  return (
    <div className="mt-2 space-y-2">
      <code className="block break-all rounded-md bg-white/70 px-2 py-1.5 text-xs text-zinc-800">{url}</code>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); }}>
          {copied ? "Copied" : "Copy link"}
        </Button>
        <a href={whatsapp} target="_blank" rel="noopener noreferrer">
          <Button size="sm" variant="secondary" type="button">Share on WhatsApp</Button>
        </a>
      </div>
    </div>
  );
}

function PermissionPicker({ value, onChange }: { value: Permission[]; onChange: (v: Permission[]) => void }) {
  return (
    <fieldset className="grid gap-2 sm:grid-cols-2">
      <legend className="mb-2 text-sm font-medium text-zinc-700">Permissions</legend>
      {DELEGABLE.map((p) => (
        <label key={p} className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            className="size-4 rounded border-zinc-300 accent-brand-500"
            checked={value.includes(p)}
            onChange={(e) => onChange(e.target.checked ? [...value, p] : value.filter((x) => x !== p))}
          />
          {PERMISSION_LABELS[p]}
        </label>
      ))}
    </fieldset>
  );
}

function sameSet(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function InviteForm({ base, locations, onDone }: { base: string; locations: Location[]; onDone: (r: { url: string; emailSent: boolean; email: string }) => void }) {
  const [role, setRole] = useState<"manager" | "staff">("staff");
  const [perms, setPerms] = useState<Permission[]>([...DEFAULT_ROLE_PERMISSIONS.staff]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email")).trim();
    const locationId = String(f.get("locationId")) || null;
    setLoading(true);
    setError(null);
    try {
      const permissions = sameSet(perms, DEFAULT_ROLE_PERMISSIONS[role]) ? null : perms;
      const res = await api<{ inviteUrl: string; emailSent: boolean }>(`${base}/invitations`, { body: { email, role, permissions, locationId } });
      onDone({ url: res.inviteUrl, emailSent: res.emailSent, email });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send invitation");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Input label="Email" name="email" type="email" required hint="They'll sign up or sign in with this email to accept" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Role"
          value={role}
          onChange={(e) => {
            const r = e.target.value as "manager" | "staff";
            setRole(r);
            setPerms([...DEFAULT_ROLE_PERMISSIONS[r]]);
          }}
        >
          <option value="staff">Staff</option>
          <option value="manager">Manager</option>
        </Select>
        <Select label="Location" name="locationId" defaultValue="">
          <option value="">All locations</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </div>
      <PermissionPicker value={perms} onChange={setPerms} />
      <div className="flex justify-end">
        <Button type="submit" loading={loading}>Create invitation</Button>
      </div>
    </form>
  );
}

function EditStaffForm({ base, member, locations, onDone }: { base: string; member: StaffMember; locations: Location[]; onDone: () => void }) {
  const [role, setRole] = useState<"manager" | "staff">(member.role === "manager" ? "manager" : "staff");
  const [perms, setPerms] = useState<Permission[]>(member.permissions);
  const [locationId, setLocationId] = useState(member.locationId ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`${base}/staff/${member.id}`, { method: "PATCH", body }),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save changes"),
  });

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Role"
          value={role}
          onChange={(e) => {
            const r = e.target.value as "manager" | "staff";
            setRole(r);
            setPerms([...DEFAULT_ROLE_PERMISSIONS[r]]);
          }}
        >
          <option value="staff">Staff</option>
          <option value="manager">Manager</option>
        </Select>
        <Select label="Location" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          <option value="">All locations</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </div>
      <PermissionPicker value={perms} onChange={setPerms} />
      <div className="flex flex-wrap justify-between gap-2 border-t border-zinc-100 pt-4">
        <Button
          variant={member.status === "active" ? "danger" : "secondary"}
          loading={save.isPending && save.variables?.status !== undefined}
          onClick={() => save.mutate({ status: member.status === "active" ? "disabled" : "active" })}
        >
          {member.status === "active" ? "Disable access" : "Re-enable access"}
        </Button>
        <Button
          loading={save.isPending && save.variables?.status === undefined}
          onClick={() =>
            save.mutate({
              role,
              permissions: sameSet(perms, DEFAULT_ROLE_PERMISSIONS[role]) ? null : perms,
              locationId: locationId || null,
            })
          }
        >
          Save
        </Button>
      </div>
    </div>
  );
}
