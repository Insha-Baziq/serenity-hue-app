import { ArrowLeft, Beaker, ClipboardList } from "lucide-react";
import Link from "next/link";
import { formatGrams } from "@/components/labs-workspace";
import { relativeTime } from "@/lib/format";
import type { LabBatch, LabFormula } from "@/lib/types";

export function LabBatchesWorkspace({ batches, formula }: { batches: LabBatch[]; formula: LabFormula | null }) {
  const heading = formula ? `${formula.title} batches` : "Batches";
  const description = formula ? "Every confirmed production batch made from this formula." : "Every confirmed production batch across your Labs formulas.";
  return <section className="workspace workspace--labs">
    <Link className="labs-back" href={formula ? `/labs/${formula.id}` : "/labs"}><ArrowLeft size={16} />{formula ? formula.title : "Labs"}</Link>
    <header className="workspace-header labs-header"><div><h1>{heading}</h1><p className="workspace-description">{description}</p></div>{formula && <Link className="ui-button ui-button--outline ui-button--default-size" href="/labs/batches"><ClipboardList size={17} />All batches</Link>}</header>
    {batches.length ? <section className="labs-batches-panel" aria-label={formula ? `${formula.title} batch history` : "All batch history"}><div className="labs-batch-list labs-batch-list--history">{batches.map((batch) => <article className="labs-batch-row" key={batch.id}><span className="labs-batch-row__icon"><Beaker size={16} /></span><div><strong>{batch.batchNumber}</strong><small>{batch.formula} · Created {relativeTime(batch.createdAt)} by {batch.actor}</small></div><span>{formatGrams(batch.targetGrams)}</span></article>)}</div></section> : <div className="labs-empty"><Beaker size={20} /><p>{formula ? "No batches have been created from this formula yet." : "No batches have been created yet. Open a formula when you are ready to create the first one."}</p></div>}
  </section>;
}
