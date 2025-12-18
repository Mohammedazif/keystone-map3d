# Vector RAG System Documentation

## Overview
The GeoConstruct AI project uses a **Retrieval-Augmented Generation (RAG)** system to provide accurate, context-aware answers to user queries about building regulations, compliance, and other technical documents.

The system ingests documents (PDF, DOCX, ZIP) from the `Documentation Rules` directory, creates vector embeddings, and stores them in a local vector store. When a user asks a question, the system retrieves relevant document chunks and uses them as context for the LLM.

## Architecture
-   **Framework**: [Genkit](https://firebase.google.com/docs/genkit)
-   **Vector Store**: `@genkit-ai/dev-local-vectorstore` (Local file-based index)
-   **Embedding Model**: `googleai/text-embedding-004` (via Google AI Plugin)
-   **LLM**: `googleai/gemini-2.5-flash`
-   **Parsers**:
    -   `pdf-parse` for PDFs
    -   `mammoth` for DOCX files
    -   `adm-zip` for ZIP archives

## Installation

### Required Packages
The RAG system requires the following packages (already added to `package.json`):

**Runtime Dependencies:**
```bash
npm install @genkit-ai/dev-local-vectorstore@1.20.0 \
            pdf-parse@1.1.1 \
            mammoth@1.11.0 \
            adm-zip@0.5.16
```

**Dev Dependencies (TypeScript types):**
```bash
npm install -D @types/pdf-parse @types/adm-zip
```

**Note**: If you've cloned the project, simply run `npm install` to install all dependencies.

## Setup & Prerequisites

1.  **Environment Variables**:
    Ensure your `.env` file contains a valid Google API key:
    ```bash
    GOOGLE_API_KEY=your_api_key_here
    ```

2.  **Verify Installation**:
    After installing dependencies, verify the setup:
    ```bash
    npm install
    ```

## Managing Documents

### Adding New Documents
1.  Place your files (PDF, DOCX, TXT, MD) or ZIP archives in the `Documentation Rules` directory at the project root.
2.  The ingestion script recursively searches this directory.

### Running Ingestion
To update the vector index with new documents, run the ingestion script:

```bash
npx tsx scripts/ingest-docs.ts
```

**Note**: This script:
1.  Reads all files in `Documentation Rules`.
2.  Extracts text and chunks it into segments.
3.  Generates embeddings using `text-embedding-004`.
4.  Saves the index locally (typically in `~/.genkit` or a local cache).

### Testing the System
You can verify the RAG system is working by running the test script:

```bash
npx tsx scripts/test-rag.ts
```

This sends a sample query ("What are the requirements for green buildings?") to the RAG flow and prints the response.

## API Usage

The RAG functionality is integrated into the main Chat API endpoint: `POST /api/chat`.

### Request Format
To use the RAG system, send a JSON body with a `query` field:

```json
{
  "query": "What is the maximum height for a residential building?"
}
```

### Response Format
The API returns a JSON object with the answer text:

```json
{
  "text": "The maximum height for a residential building on a plot of this size is..."
}
```

(Note: The API also supports the legacy `soilPh`, `soilBd`, and `buildingDescription` parameters for soil suitability assessment, which bypasses the RAG flow.)

## Troubleshooting

-   **`ConnectTimeoutError` during ingestion**: If you have a large number of documents, the ingestion script might hit API rate limits or timeouts. The script processes files in batches to mitigate this, but you may need to re-run it if it fails. It skips already indexed chunks.
-   **"I don't know" responses**: If the AI returns "I don't know", it means the relevant information was not found in the vector store. Check if the document containing the answer was correctly ingested.
-   **Missing API Key**: Ensure `GOOGLE_API_KEY` is set in `.env`. The scripts use `dotenv` to load this.
