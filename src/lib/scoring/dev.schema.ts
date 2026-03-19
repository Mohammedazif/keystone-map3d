export const DEV_SCHEMA = {
  type: "development",
  totalMaxScore: 1000,
  passThreshold: 700,
  categories: [
    {
      id: "A",
      title: "Land Use",
      mandatory: true,
      items: [
        { id: "A1", title: "Zoning compliance", mandatory: true, maxScore: 60 },
        { id: "A2", title: "CLU approval", mandatory: true, maxScore: 0 }
      ]
    },
    {
      id: "B",
      title: "FAR",
      items: [
        { id: "B1", title: "FAR compliance", maxScore: 100 }
      ]
    },
    {
      id: "C",
      title: "Setbacks",
      items: [
        { id: "C1", title: "Front setback", maxScore: 40 },
        { id: "C2", title: "Side setback", maxScore: 40 }
      ]
    }
  ]
} as const;