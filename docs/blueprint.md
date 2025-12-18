# **App Name**: GeoConstruct AI

## Core Features:

- Map Editor: Allows users to draw a polygon on a Mapbox map to define a building footprint, then generate a 3D extruded building with customizable height, color and opacity.
- Soil Data Fetching: Fetches soil data from SoilGrids API for the polygon's centroid upon polygon closure. The types of information fetched will be pH and bulk density.
- Chat Interface: A chat panel allows users to ask questions about the building, leveraging an LLM to answer construction, costs, and soil suitability.
- AI Query Tool: The AI will incorporate data about building specifications, such as its dimensions, soil analysis from the SoilGrids API, and more when answering questions about the construction project. It can also call external tools when reasoning about a response to a prompt, such as fetching current material costs.
- Data Persistence: Allows the user to save/load building data as JSON. Building data will contain geometry, height, color, opacity, centroid, and soil data.
- Error Handling: Uses react-hot-toast to display error notifications when the application fails to get the user's location, fails to communicate with the Soil Grids API, or fails to get a response from the LLM.

## Style Guidelines:

- Primary color: Deep sky blue (#42A5F5) to create a modern and trustworthy aesthetic related to construction and precision.
- Background color: Dark navy (#1A237E) to provide contrast and highlight the interface elements against a dark background.
- Accent color: Light blue (#64B5F6), analogous to the primary but lighter and less saturated, used for interactive elements like buttons and highlights.
- Font pairing: Use 'Space Grotesk' (sans-serif) for headlines, paired with 'Inter' (sans-serif) for body text, offering a balance of technical precision and readability.
- Code font: 'Source Code Pro' for displaying code snippets (such as JSON building data).
- Crisp, line-based icons representing mapping, soil analysis, and building elements, for clarity and modern UI.
- Responsive layout with Map taking 70% of the width on desktop, and the editor/chat panel using 20% each. Collapsible sidebar and chat panel on mobile.