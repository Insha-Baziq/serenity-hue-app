export type LabFormulaLineSeed = {
  ingredient: string;
  percentage?: number;
  calculation: "fixed" | "remainder" | "manual";
  phase?: string;
  note?: string;
};

export type LabFormulaSeed = {
  id: string;
  title: string;
  subtitle: string;
  notes: string;
  lines: LabFormulaLineSeed[];
};

// These formulas transcribe the client-supplied ratio sheets. Do not substitute
// ingredients or infer a percentage where the sheet says q.s.
export const LAB_FORMULAS: LabFormulaSeed[] = [
  {
    id: "lab-lash-serum-v2",
    title: "7-Peptide Lash Serum",
    subtitle: "Version 2 · heavy-tack peptide lash serum",
    notes: "Target pH 6.3–6.5. Citric acid and sodium hydroxide are manual q.s. adjustments and are not auto-deducted.",
    lines: [
      { ingredient: "Deionised Water", calculation: "remainder", phase: "A", note: "q.s. to 100" },
      { ingredient: "Glycerin", percentage: 2, calculation: "fixed", phase: "A" },
      { ingredient: "Pentylene Glycol", percentage: 2, calculation: "fixed", phase: "A" },
      { ingredient: "Trehalose", percentage: 1, calculation: "fixed", phase: "A" },
      { ingredient: "Panthenol", percentage: 1, calculation: "fixed", phase: "A" },
      { ingredient: "Allantoin", percentage: 0.3, calculation: "fixed", phase: "A" },
      { ingredient: "Caffeine", percentage: 0.2, calculation: "fixed", phase: "A" },
      { ingredient: "Sodium Phytate", percentage: 0.1, calculation: "fixed", phase: "A" },
      { ingredient: "Sodium Citrate", percentage: 0.3, calculation: "fixed", phase: "A" },
      { ingredient: "Hydroxyethylcellulose (HEC)", percentage: 0.25, calculation: "fixed", phase: "B" },
      { ingredient: "PVP K-30", percentage: 1.2, calculation: "fixed", phase: "B" },
      { ingredient: "Pullulan", percentage: 0.2, calculation: "fixed", phase: "B" },
      { ingredient: "Dimethyl Isosorbide (DMI)", percentage: 1, calculation: "fixed", phase: "C" },
      { ingredient: "Myristoyl Pentapeptide-17 stock (~5%)", percentage: 4, calculation: "fixed", phase: "C" },
      { ingredient: "Biotinoyl Tripeptide-1 stock (2.5%)", percentage: 4, calculation: "fixed", phase: "C" },
      { ingredient: "Acetyl Tetrapeptide-3 stock (2.5%)", percentage: 4, calculation: "fixed", phase: "C" },
      { ingredient: "Copper Tripeptide-1 stock (1000 ppm)", percentage: 0.05, calculation: "fixed", phase: "C" },
      { ingredient: "Myristoyl Hexapeptide-16 stock (500 ppm)", percentage: 0.01, calculation: "fixed", phase: "C" },
      { ingredient: "Palmitoyl Tetrapeptide-7 stock (500 ppm)", percentage: 0.01, calculation: "fixed", phase: "C" },
      { ingredient: "Natural Pea Peptide stock (12-17%)", percentage: 1, calculation: "fixed", phase: "C" },
      { ingredient: "Pumpkin Seed Extract", percentage: 0.25, calculation: "fixed", phase: "C" },
      { ingredient: "Red Clover Extract", percentage: 0.2, calculation: "fixed", phase: "C" },
      { ingredient: "Plantserv E", percentage: 1, calculation: "fixed", phase: "D" },
      { ingredient: "1,2-Hexanediol", percentage: 0.3, calculation: "fixed", phase: "D" },
      { ingredient: "Citric Acid", calculation: "manual", phase: "D", note: "q.s. for pH adjustment" },
      { ingredient: "Sodium Hydroxide solution", calculation: "manual", phase: "D", note: "q.s. for pH adjustment" },
    ],
  },
  {
    id: "lab-thd-vitamin-c-serum",
    title: "20% THD Vitamin C Serum",
    subtitle: "Final rebalanced formula",
    notes: "All listed ratios total 100%.",
    lines: [
      { ingredient: "Tetrahexyldecyl Ascorbate (THD Vitamin C)", percentage: 20, calculation: "fixed" },
      { ingredient: "Squalane", percentage: 27.6, calculation: "fixed" },
      { ingredient: "Caprylic/Capric Triglyceride", percentage: 15, calculation: "fixed" },
      { ingredient: "Isododecane", percentage: 17, calculation: "fixed" },
      { ingredient: "Isohexadecane", percentage: 6, calculation: "fixed" },
      { ingredient: "C12-15 Alkyl Benzoate", percentage: 7.08, calculation: "fixed" },
      { ingredient: "Meadowfoam Seed Oil", percentage: 3, calculation: "fixed" },
      { ingredient: "Silica Dimethyl Silylate", percentage: 1.5, calculation: "fixed" },
      { ingredient: "Tocopherol (Vitamin E)", percentage: 1, calculation: "fixed" },
      { ingredient: "Bisabolol", percentage: 0.3, calculation: "fixed" },
      { ingredient: "Astaxanthin", percentage: 0.02, calculation: "fixed" },
      { ingredient: "Grapefruit Essential Oil (FCF)", percentage: 1.5, calculation: "fixed" },
    ],
  },
  {
    id: "lab-overnight-brow-jelly",
    title: "Strong Honey-Coffee Overnight Brow Jelly",
    subtitle: "Working formula",
    notes: "All listed ratios total 100%. Development levels in the source sheet remain subject to validation.",
    lines: [
      { ingredient: "Castor Oil", percentage: 53.4, calculation: "fixed" },
      { ingredient: "Caprylic/Capric Triglyceride (CCT)", percentage: 25, calculation: "fixed" },
      { ingredient: "Hydrogenated Castor Oil", percentage: 15, calculation: "fixed" },
      { ingredient: "Pumpkin Seed Oil", percentage: 2, calculation: "fixed" },
      { ingredient: "Saw Palmetto Oil", percentage: 1, calculation: "fixed" },
      { ingredient: "Grapeseed Oil", percentage: 1, calculation: "fixed" },
      { ingredient: "Coffee Bean Oil", percentage: 1, calculation: "fixed" },
      { ingredient: "Coffee CO2 Extract (aromatic)", percentage: 0.5, calculation: "fixed" },
      { ingredient: "Benzoin (aromatic)", percentage: 0.5, calculation: "fixed" },
      { ingredient: "Tocopherol (Vitamin E)", percentage: 0.5, calculation: "fixed" },
      { ingredient: "Rosemary CO2 Extract", percentage: 0.1, calculation: "fixed" },
    ],
  },
  {
    id: "lab-under-eye-serum-v2",
    title: "Streamlined Under-Eye Serum",
    subtitle: "Working formula v2",
    notes: "All listed ratios total 100%. Final pH, stability, packaging compatibility, and preservative efficacy remain to be confirmed before manufacture.",
    lines: [
      { ingredient: "Aqua (Water)", percentage: 70, calculation: "fixed" },
      { ingredient: "Propanediol", percentage: 3, calculation: "fixed" },
      { ingredient: "Glycerin + Tremella Extract", percentage: 3, calculation: "fixed" },
      { ingredient: "Glycerin + Cucumber Extract", percentage: 2.5, calculation: "fixed" },
      { ingredient: "Niacinamide", percentage: 2, calculation: "fixed" },
      { ingredient: "Betaine", percentage: 1.5, calculation: "fixed" },
      { ingredient: "Matrixyl 3000", percentage: 2, calculation: "fixed" },
      { ingredient: "Matrixyl Synthe'6", percentage: 2, calculation: "fixed" },
      { ingredient: "Haloxyl", percentage: 2.5, calculation: "fixed" },
      { ingredient: "Caffeine", percentage: 0.3, calculation: "fixed" },
      { ingredient: "Ascorbyl Glucoside", percentage: 2, calculation: "fixed" },
      { ingredient: "Tranexamic Acid", percentage: 3, calculation: "fixed" },
      { ingredient: "Saccharide Isomerate", percentage: 3, calculation: "fixed" },
      { ingredient: "Panthenol / Vitamin B5", percentage: 1.2, calculation: "fixed" },
      { ingredient: "EcoGel (Pullulan)", percentage: 0.21, calculation: "fixed" },
      { ingredient: "Potassium Phytate", percentage: 0.1, calculation: "fixed" },
      { ingredient: "Plantserv E", percentage: 1, calculation: "fixed" },
      { ingredient: "Potassium Sorbate", percentage: 0.19, calculation: "fixed" },
      { ingredient: "Sodium Citrate", percentage: 0.4, calculation: "fixed" },
      { ingredient: "Citric Acid", percentage: 0.1, calculation: "fixed" },
    ],
  },
];
