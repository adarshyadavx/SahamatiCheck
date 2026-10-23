import type { Ontology } from '@sahamati/contracts';
import { createContext, useContext, type ReactNode } from 'react';
import { useI18n } from './I18n';

const OntologyContext = createContext<Ontology | null>(null);

export function OntologyProvider({ ontology, children }: { ontology: Ontology | null; children: ReactNode }) {
  return <OntologyContext.Provider value={ontology}>{children}</OntologyContext.Provider>;
}

export function prettifyId(id: string): string {
  const bare = id.replace(/^[a-z]+:/, '').replace(/_/g, ' ');
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

/** Label for an ontology id in the current language, falling back to a readable id. */
export function useOntologyLabel(): (id: string) => string {
  const ontology = useContext(OntologyContext);
  const { lang } = useI18n();
  return (id: string) => {
    const bare = id.replace(/^[a-z]+:/, '');
    const node = ontology?.nodes.find((n) => n.id === id || n.id === bare || n.id.replace(/^[a-z]+:/, '') === bare);
    if (node) return lang === 'hi' ? node.label_hi || node.label_en : node.label_en;
    return prettifyId(id);
  };
}
