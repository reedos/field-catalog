/**
 * What to do, in the order you would actually do it.
 *
 * The app has a lot of surface -- import, identify, bursts, cull, life list,
 * export, offload, delete -- and nothing anywhere says which order any of it
 * goes in. The README does, but the README is not in the window.
 *
 * This is deliberately a workflow rather than a feature list: a feature list
 * tells you what exists, an order tells you what to do on a Sunday evening
 * with a full card. The safety rules are stated once, here, because they are
 * the part worth reading before the first delete rather than after.
 */
export default function Guide(props: { keys: { keep: string; reject: string; next: string } }) {
  return (
    <div className="fc-scroll h-full p-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 border-b border-bark pb-3">
          <h2 className="font-serif text-2xl text-paper">How this works</h2>
          <p className="mt-1 text-sm text-paper-dim">
            A good morning comes home as a card full of nearly identical frames. This is the
            order that turns it into a handful of keepers.
          </p>
        </div>

        <Step n={1} title="Import">
          <p>
            <B>Import folder</B> points at a card or a folder of originals. Nothing is copied and
            nothing is moved — Field Catalog reads your files where they sit and builds its own
            small previews beside the catalog. Your originals stay exactly where you put them,
            untouched, including their EXIF.
          </p>
        </Step>

        <Step n={2} title="Identify (optional)">
          <p>
            <B>Identify series</B> names what is in the frame: common and scientific name, the
            animal type, and the field marks it used to decide. It needs either a local Ollama
            model or an API key, both set up in Settings. Skip it entirely if you would rather
            name things yourself — every field it fills in is editable, and correcting one is
            often faster than typing from scratch.
          </p>
        </Step>

        <Step n={3} title="Resolve the bursts">
          <p>
            Frames shot within eight seconds of each other are grouped as a burst. Most of a
            wildlife card is bursts, so this is where the work is.
          </p>
          <p>
            <B>Cull them all</B> in the Bursts view walks the whole queue: every frame of a burst
            on one wall, pan and zoom synced across them, and the next burst opens as soon as you
            finish one. Mark the keepers and reject the rest, or flag the duds and keep the rest —
            whichever suits the burst. <K>Esc</K> leaves the run whenever you like.
          </p>
        </Step>

        <Step n={4} title="Cull the rest">
          <p>
            Back in the Library, <K>{props.keys.next === "ArrowRight" ? "→" : props.keys.next}</K>{" "}
            walks the shots, <K>{props.keys.keep}</K> keeps, <K>{props.keys.reject}</K> rejects,
            and <K>1</K>–<K>5</K> rate. Press <K>?</K> at any time for the full list. Everything
            is undoable with <K>Ctrl+Z</K>.
          </p>
        </Step>

        <Step n={5} title="See what you have">
          <p>
            The <B>Life list</B> gives one plate per species, numbered in the order you first saw
            them. The best frame is chosen for you; click a plate to open it and overrule that.
            The <B>Map</B> shows everything carrying GPS, and a place lists the different species
            found there rather than the same one twenty times.
          </p>
        </Step>

        <Step n={6} title="Export, or make room">
          <p>
            <B>Export keepers</B> copies your keeps to a folder of your choosing with a
            metadata.csv beside them. <B>Delete rejected</B> and <B>Offload keepers</B> are the
            only things that ever touch your original files, and they are deliberately slow to
            use. Read the next section before either.
          </p>
        </Step>

        <div className="mt-10 border-t border-bark pt-5">
          <h3 className="font-serif text-lg text-paper">What never happens without you asking</h3>
          <ul className="mt-3 space-y-2 text-sm text-paper-dim">
            <Rule>
              <B>Reject is a label, not a delete.</B> Rejecting a shot marks it. No file moves and
              no file is removed. You can reject a whole card and change your mind.
            </Rule>
            <Rule>
              <B>Every removal is previewed first.</B> Delete and offload show you the exact list
              of files they would touch, and will not proceed until you type the confirmation
              string. The count you see is the count that happens.
            </Rule>
            <Rule>
              <B>Deleted originals go to the recycle bin</B>, not into thin air, unless you
              explicitly ask for a permanent unlink.
            </Rule>
            <Rule>
              <B>The catalog is backed up before every removal.</B> If the backup fails, the
              removal is abandoned rather than attempted.
            </Rule>
            <Rule>
              <B>Previews are never deleted</B> and neither is the catalog. Remove every original
              and you still have the record of what you shot.
            </Rule>
            <Rule>
              <B>Coordinates come from your files only.</B> Nothing is inferred from where you are
              or where the app thinks you might be. A place name you type is a label; it never
              becomes GPS.
            </Rule>
            <Rule>
              <B>Every executed removal is written down</B> in the library's audit log, with what
              went and when.
            </Rule>
          </ul>
        </div>

        <div className="mt-10 border-t border-bark pt-5 pb-4">
          <h3 className="font-serif text-lg text-paper">Where things live</h3>
          <p className="mt-2 text-sm text-paper-dim">
            Everything Field Catalog owns sits in one folder, <Code>~/FieldCatalog</Code> by
            default: the <Code>catalog.sqlite</Code> record, the <Code>previews/</Code> it builds,
            rotating <Code>backups/</Code>, and <Code>audit.jsonl</Code>. Copy that folder and you
            have copied your catalog. Delete it and your photographs are still wherever they
            always were.
          </p>
        </div>
      </div>
    </div>
  );
}

function Step(props: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-7 flex gap-4">
      <div className="shrink-0 pt-0.5 font-serif text-lg text-ochre">{props.n}</div>
      <div className="min-w-0">
        <h3 className="font-serif text-lg text-paper">{props.title}</h3>
        <div className="mt-1 space-y-2 text-sm leading-relaxed text-paper-dim">{props.children}</div>
      </div>
    </div>
  );
}

function Rule(props: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="text-moss">·</span>
      <span className="leading-relaxed">{props.children}</span>
    </li>
  );
}

function B(props: { children: React.ReactNode }) {
  return <span className="text-paper">{props.children}</span>;
}

function K(props: { children: React.ReactNode }) {
  return <kbd className="fc-kbd">{props.children}</kbd>;
}

function Code(props: { children: React.ReactNode }) {
  return <code className="text-ochre">{props.children}</code>;
}
