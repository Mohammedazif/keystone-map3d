export const GRIHA_SCHEMA = {
  id: "griha",
  name: "GRIHA v2019",
  maxScore: 100,

  categories: [
    {
      id: "site",
      name: "Cluster A: Site",
      maxScore: 20,
      items: [
        { id: "site_selection", maxScore: 2, mandatoryScore: 2 },
        { id: "topsoil", maxScore: 4, mandatoryScore: 2 },
        { id: "infrastructure", maxScore: 2 },
        { id: "landscape_water", maxScore: 3 },
        { id: "water_use", maxScore: 5, mandatoryScore: 3 },
        { id: "stp", maxScore: 4, mandatoryScore: 2 }
      ]
    },
    {
      id: "planning",
      name: "Cluster B: Building Planning",
      maxScore: 20,
      items: [
        { id: "passive_design", maxScore: 8, mandatoryScore: 4 },
        { id: "envelope", maxScore: 8, mandatoryScore: 4 },
        { id: "materials", maxScore: 4 }
      ]
    },
    {
      id: "systems",
      name: "Cluster C: Building Systems",
      maxScore: 25,
      items: [
        { id: "energy", maxScore: 12, mandatoryScore: 8 },
        { id: "lighting", maxScore: 4, mandatoryScore: 2 },
        { id: "hvac", maxScore: 4, mandatoryScore: 2 },
        { id: "monitoring", maxScore: 3 },
        { id: "renewable", maxScore: 2 }
      ]
    },
    {
      id: "health",
      name: "Cluster D: Health & Comfort",
      maxScore: 15,
      items: [
        { id: "iaq", maxScore: 4, mandatoryScore: 2 },
        { id: "voc", maxScore: 3 },
        { id: "thermal", maxScore: 3 },
        { id: "visual", maxScore: 3 },
        { id: "acoustic", maxScore: 2 }
      ]
    },
    {
      id: "waste",
      name: "Cluster E: Waste",
      maxScore: 10,
      items: [
        { id: "organic", maxScore: 4, mandatoryScore: 2 },
        { id: "segregation", maxScore: 3 },
        { id: "construction", maxScore: 3 }
      ]
    },
    {
      id: "social",
      name: "Cluster F: Social",
      maxScore: 10,
      items: [
        { id: "om", maxScore: 3, mandatoryScore: 2 },
        { id: "education", maxScore: 2 },
        { id: "audit", maxScore: 3 },
        { id: "accessibility", maxScore: 2 }
      ]
    }
  ]
};