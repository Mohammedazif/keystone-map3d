# Key Stone AI: Real-Estate Feasibility Platform

This document provides a comprehensive overview of the **Key Stone AI** application, a powerful platform for real-estate query and building estimation. It allows users to design building layouts on a map, analyze environmental data, and leverage AI to assess project feasibility.

## Table of Contents
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Environment Variables](#environment-variables)
  - [Installation & Running](#installation--running)
- [Features](#features)
- [Pages](#pages)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)

---

## Getting Started

This section will guide you through setting up and running the project on your local machine.

### Prerequisites

- Node.js (v18 or later)
- npm or yarn

### Environment Variables

Before you can run the application, you need to create a `.env` file in the root of the project. This file is used to store sensitive keys and configuration settings.

1.  Create a file named `.env` in the project root.
2.  Add the following variables to it:

```env
# Required for Mapbox GL JS to render maps.
# Get a free token from https://www.mapbox.com/
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN="YOUR_MAPBOX_ACCESS_TOKEN"

# Required for Google AI (Gemini) features via Genkit.
# Get an API key from Google AI Studio.
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"

# The Firebase project configuration is currently hardcoded in `src/lib/firebase.ts`.
# For a production setup, you would typically move these into environment variables as well.
```

### Installation & Running

1.  **Install dependencies:**
    ```bash
    npm install
    ```
2.  **Run the development server:**
    The application uses Next.js. To start the development server, run:
    ```bash
    npm run dev
    ```
    The application will be available at `http://localhost:9002`.

3.  **Run the Genkit AI flows (optional):**
    For the AI features to work, you also need to run the Genkit development server in a separate terminal:
    ```bash
    npm run genkit:watch
    ```

---

## Features

This is a list of the core functionalities that have been built into the **Key Stone AI** platform.

### 1. Interactive Map & Drawing Tools
- **Dynamic Map Interface**: The core of the application is a high-performance, interactive map powered by Mapbox, allowing for smooth panning, zooming, and tilting.
- **Polygon Drawing**: Users have intuitive tools to draw various types of polygons directly on the map, including main property plots, specific zones (like green areas or parking), and building footprints.
- **3D Visualization**: As soon as a building footprint is drawn, it is automatically extruded into a 3D model. This provides immediate visual feedback on the building's mass and scale.
- **Object Selection & Interaction**: Every object drawn on the map (plots, buildings, zones) is interactive. Users can click on any object to select it, which highlights it and brings up its specific properties in the sidebar for editing.

### 2. Advanced Properties & Customization
- **Real-time Customization**: When an object is selected, its properties are displayed in a dedicated panel. For buildings, users can adjust attributes like the number of floors, floor height, and opacity, and see the 3D model update instantly.
- **Setback Visualization**: For plots, the required property setback is visualized as a dashed line inside the plot boundary. This setback can be adjusted in the properties panel, providing a clear visual guide for compliant building placement.
- **Detailed Object Properties**: The properties panel is context-aware, showing only the relevant information for the selected object, whether it's a plot's name, a building's height, or a zone's intended use.

### 3. AI-Powered Site & Cost Analysis
- **AI Site Layout Generator**: This powerful feature allows users to select a plot and provide a simple text prompt (e.g., "Two residential towers and a park"). The AI then generates two distinct layout scenarios based on this prompt, which the user can review. Applying a scenario automatically creates the specified buildings and zones within the plot.
- **AI Cost Estimation Chat**: An integrated AI assistant is available within the project editor. Users can select a building and ask the AI assistant questions about it. The AI uses the building's data (like area, number of floors, and intended use) to provide cost estimations and answer feasibility questions.
- **AI Massing Generator**: Users can select a plot or buildable zone and have the AI automatically generate two distinct 3D massing options that comply with local development regulations.

### 4. Data Management & Persistence
- **Firestore Integration**: All project data, including plot geometries, building models, and user information, is securely stored and managed in a Google Firestore database. This ensures data persistence across sessions.
- **Project Management**: Authenticated users have a personal dashboard where they can create multiple projects. This dashboard lists all their projects, allowing them to open, edit, or delete them as needed.
- **User Authentication**: The platform includes secure sign-in functionality using Firebase Authentication (specifically, "Sign in with Google"). This ensures that each user's projects are private and accessible only to them.

### 5. Administrative Controls
- **Regulations Admin Panel**: There is a dedicated, access-controlled page for administrators to manage development regulations.
- **CRUD Functionality**: Admins have full Create, Read, Update, and Delete (CRUD) capabilities for all regulations, which are organized by location and type.
- **Dual Editing Modes**: Regulations can be edited through a user-friendly form or a raw JSON editor for maximum flexibility.

---

## Pages

These are the distinct pages and views that make up the application's user interface.

- **`/sign-in`**: The authentication page featuring a "Sign in with Google" button.
- **`/`**: The main dashboard for authenticated users, displaying their project list and allowing project creation.
- **`/dashboard/project/[id]`**: The core project editor, featuring the map, drawing tools, properties panel, and AI assistants.
- **`/admin`**: A secure page for administrators to manage development regulations, accessible only to authorized users.

---

## Project Structure

The project follows a standard Next.js App Router structure. Here's a brief overview of the key directories:

```
/
├── src/
│   ├── app/                # Next.js App Router pages and layouts
│   │   ├── admin/          # Admin panel page
│   │   ├── api/            # API routes
│   │   └── dashboard/      # User dashboard and project editor
│   ├── ai/                 # Genkit AI flows and configuration
│   │   └── flows/          # Specific AI agent implementations
│   ├── components/         # Reusable React components
│   │   └── ui/             # Core UI components from Shadcn/UI
│   ├── hooks/              # Custom React hooks (e.g., useBuildingStore)
│   └── lib/                # Shared utilities, types, and Firebase config
└── public/                 # Static assets
```

---

## Tech Stack
- **Framework**: Next.js (App Router)
- **Language**: TypeScript
- **UI Libraries**: React, Tailwind CSS, Shadcn/UI
- **State Management**: Zustand
- **Mapping**: Mapbox GL JS, Turf.js
- **Database**: Google Firestore
- **Authentication**: Firebase Authentication
- **AI**: Google's Gemini model via Genkit
