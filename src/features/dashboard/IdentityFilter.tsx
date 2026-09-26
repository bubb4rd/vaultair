import { useIdentityRefs } from "@/app/queries";
import { NativeSelect } from "@/components/ui/textarea";
import { useIdentityFilter } from "./useIdentityFilter";

/** The session-wide identity filter, shared by the dashboard and Security Health. */
export function IdentityFilter() {
  const refs = useIdentityRefs();
  const [identityId, setIdentityId] = useIdentityFilter();
  if (!refs.data || refs.data.length === 0) return null;
  return (
    <div className="w-48">
      <NativeSelect
        aria-label="Filter by identity"
        className="h-7 text-[13px]"
        value={identityId ?? ""}
        onChange={(e) => {
          setIdentityId(e.target.value || null);
        }}
      >
        <option value="">All identities</option>
        {refs.data.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
