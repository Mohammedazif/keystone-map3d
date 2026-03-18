export const GREEN_SCHEMA = {
  type: "green",
  totalMaxScore: 100,
  categories: [
    {
      id: "SS",
      title: "Sustainable Site",
      maxScore: 20,
      items: [
        { id: "SS1", title: "Site selection", maxScore: 4 },
        { id: "SS2", title: "Transport access", maxScore: 4 }
      ]
    },
    {
      id: "WE",
      title: "Water Efficiency",
      maxScore: 20,
      items: [
        { id: "WE1", title: "Rainwater harvesting", maxScore: 5, mandatory: true },
        { id: "WE2", title: "Water reuse", maxScore: 5 }
      ]
    },
    {
      id: "EA",
      title: "Energy",
      maxScore: 30,
      priority: "high",
      items: [
        { id: "EA1", title: "Energy performance", maxScore: 16 },
        { id: "EA2", title: "Renewables", maxScore: 5 }
      ]
    }
  ]
} as const;