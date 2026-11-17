/** Local & Maps: where the business shows up in Google Maps, by location, plus the heat map. */
import { requireClient } from "@/lib/access";
import { hasDataForSeo } from "@/lib/dataforseo";
import { trackedTable } from "@/lib/seo";
import { latestScans } from "@/lib/heatmap";
import { ClientShell } from "@/components/ClientShell";
import { HeatMap, KeywordControls, LocationsForm, TrackedTable } from "@/components/Rankings";

export default async function Local({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ e?: string; hm?: string; saved?: string }> }) {
  const { clientId } = await params;
  const { e, hm, saved } = await searchParams;
  const { client, user } = await requireClient(clientId);
  const [tracked, scans] = await Promise.all([trackedTable(client.id), latestScans(client.id)]);
  const when = new Intl.DateTimeFormat("en-US", { timeZone: client.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const connected = hasDataForSeo();
  const hasPlaces = Object.keys(client.gbpPlaces).length > 0;
  const ready = client.rankLocations.length > 0;
  const locForm = user.isAgency && <LocationsForm clientId={client.id} back="local" locations={client.rankLocations} gbpName={client.gbpName}
    placeholderName={client.name} places={client.gbpPlaces} saved={saved === "1"} />;

  return (
    <ClientShell client={client} active="local" isAgency={user.isAgency}>
      <div><h1 className="vt">Local &amp; Maps</h1>
        <p className="vsub">Where {client.name} shows up in Google Maps around {ready ? client.rankLocations.map((l) => l.split(",")[0]).join(" and ") : "each location"}.</p></div>
      {!ready && locForm}
      <section className="panel">
        <div className="ph"><h2>Google Maps rankings</h2><span>top 20 map listings · checked every week</span></div>
        <TrackedTable rows={tracked} engine="maps" clientId={client.id} back="local" isAgency={user.isAgency} when={when} />
        {user.isAgency && <KeywordControls clientId={client.id} back="local" error={client.rankCheckError} e={e} connected={connected} ready={ready} />}
      </section>
      <HeatMap scans={scans} selected={scans.find((s) => s.id === hm) ?? scans[0] ?? null} clientId={client.id} isAgency={user.isAgency}
        canRun={hasPlaces && connected} e={e} when={when} hasPlaces={hasPlaces} />
      <section className="panel"><div className="ph"><h2>Business Profile activity</h2><span>calls, website clicks, directions</span></div>
        <p className="empty">Coming with the Google connection: calls, website clicks and direction requests from each Business Profile.</p></section>
      {ready && locForm}
    </ClientShell>
  );
}
