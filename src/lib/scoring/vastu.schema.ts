export const VASTU_SCHEMA = {
  type: "vastu",
  totalMaxScore: 20, // only A + B for now
  categories: [
    {
      id: "A",
      title: "Site Shape & Slope",
      maxScore: 10,
      items: [
        { id: "A1", title: "Plot shape", maxScore: 4 },
        { id: "A2", title: "Slope NE-SW", maxScore: 4 },
        { id: "A3", title: "Open sides", maxScore: 2 }
      ]
    },
    {
      id: "B",
      title: "Entrance & Gate",
      maxScore: 10,
      items: [
        {
          id: "B1",
          title: "Entrance direction",
          maxScore: 5,
          type: "direction",
          idealDirections: ["N", "NE", "E"],
          avoidDirections: ["SW"]
        },
        { id: "B2", title: "No SW entrance", maxScore: 3 },
        { id: "B3", title: "Gate alignment", maxScore: 2 }
      ]
    }
  ]
} as const;