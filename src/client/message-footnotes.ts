import type { Element, Root } from 'hast';

export const footnoteLimits = { notes: 100, references: 300 } as const;
export type FootnoteControl = {
  id?: string;
  target: string;
  label: string;
};

function elements(root: Root | Element): Element[] {
  const found: Element[] = [];
  const pending = [...root.children].reverse();
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type !== 'element') continue;
    found.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]!);
  }
  return found;
}

/** Only parser-generated footnote edges become controls; source URLs never grant navigation. */
export function messageFootnotes(scope: string) {
  const controls = new WeakMap<Element, FootnoteControl>();
  const targets = new WeakMap<Element, string>();
  const headings = new WeakMap<Element, string>();
  const sections = new WeakMap<Element, { heading?: string; notice?: string }>();
  const prefix = `aib-note-${scope.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  function plugin() {
    return (root: Root) => {
      const section = root.children.find(
        (node): node is Element =>
          node.type === 'element' &&
          node.tagName === 'section' &&
          node.properties.dataFootnotes === true,
      );
      if (!section) return;
      const heading = section.children.find(
        (node): node is Element =>
          node.type === 'element' &&
          node.tagName === 'h2' &&
          node.properties.id === 'footnote-label',
      );
      const list = section.children.find(
        (node): node is Element => node.type === 'element' && node.tagName === 'ol',
      );
      if (!heading || !list) return;
      const notes = list.children.filter(
        (node): node is Element =>
          node.type === 'element' &&
          node.tagName === 'li' &&
          typeof node.properties.id === 'string',
      );
      const refs = elements(root).filter(
        (node) => node.tagName === 'a' && node.properties.dataFootnoteRef === true,
      );
      sections.set(section, {});
      if (notes.length > footnoteLimits.notes || refs.length > footnoteLimits.references) {
        sections.set(section, {
          notice: `Footnote navigation is limited to ${footnoteLimits.notes} notes and ${footnoteLimits.references} references per message. Notes remain readable; View source preserves the original text.`,
        });
        return;
      }

      const noteRefs = notes.map(() => new Map<string, FootnoteControl>());
      const collected: [Element, FootnoteControl][] = [];
      for (const ref of refs) {
        const number =
          ref.children.length === 1 && ref.children[0]?.type === 'text'
            ? Number(ref.children[0].value)
            : NaN;
        const index = number - 1;
        const note = Number.isInteger(number) && number > 0 ? notes[index] : undefined;
        const owned = noteRefs[index];
        const oldId = ref.properties.id;
        if (
          !note ||
          !owned ||
          typeof oldId !== 'string' ||
          ref.properties.href !== `#${note.properties.id}` ||
          owned.has(oldId)
        )
          return;
        const occurrence = owned.size + 1;
        const control = {
          id: `${prefix}-${number}-ref-${occurrence}`,
          target: `${prefix}-${number}`,
          label: `Read footnote ${number}, reference ${occurrence}`,
        };
        owned.set(oldId, control);
        collected.push([ref, control]);
      }

      // Backlinks resolve within their own definition, even when parser IDs collide
      // between labels such as "a" (second reference) and "a-2" (first reference).
      for (const [index, note] of notes.entries()) {
        const owned = noteRefs[index]!;
        for (const back of elements(note)) {
          if (
            back.tagName !== 'a' ||
            back.properties.dataFootnoteBackref !== '' ||
            typeof back.properties.href !== 'string'
          )
            continue;
          const original = owned.get(back.properties.href.slice(1));
          if (!original?.id) continue;
          collected.push([
            back,
            {
              target: original.id,
              label: original.label.replace('Read footnote', 'Back to footnote'),
            },
          ]);
        }
      }
      const headingId = `${prefix}-heading`;
      sections.set(section, { heading: headingId });
      headings.set(heading, headingId);
      notes.forEach((note, index) => targets.set(note, `${prefix}-${index + 1}`));
      for (const [node, control] of collected) controls.set(node, control);
    };
  }

  return { controls, targets, headings, sections, plugin };
}

/** Deliberate focus/scroll stays inside the mounted formatted message, without hash navigation. */
export function focusFootnote(root: HTMLElement | null, id: string) {
  if (!root?.isConnected) return;
  const target = Array.from(root.querySelectorAll<HTMLElement>('[id]')).find(
    (node) => node.id === id,
  );
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
}
