# Data Unifier

A smart web tool designed to merge, clean, and unify data from two distinct sources: a structured text input and a raw JSON file. It intelligently processes exam questions, using AI to clean up messy data and produce a single, clean JSON output.

## The Problem It Solves

Often, you might have data scattered across different formats. For example, a set of exam questions might exist in a simple, well-structured text format, while another set of the same exam's questions are only available in a messy, raw JSON format with a lot of noise (like HTML tags, navigation elements, or irrelevant metadata).

This tool was built to solve that exact problem. It takes the clean data from the text source as the "ground truth" and intelligently fills in the missing questions by cleaning up the corresponding entries from the messy JSON source using the power of the Google Gemini AI.

## Core Features

-   **Dual Data Input**: Accepts data from two separate text areas—one for structured text and one for raw JSON.
-   **Intelligent Merging Logic**: It identifies which questions are present in the text input and which are missing. For the missing ones, it looks them up by their index in the provided JSON data.
-   **AI-Powered Cleaning**: Leverages the Google Gemini API to parse the complex and noisy `question` and `answer` fields from the JSON source. It precisely extracts the core question text and the correct answer, discarding all irrelevant data.
-   **Unified JSON Output**: The final result is a single, clean, and well-structured JSON array, combining the data from both sources.
-   **User-Friendly Interface**: A simple and intuitive UI that allows you to easily paste your data, process it with a single click, and then copy the result to your clipboard or download it as a `.json` file.

## How to Use

1.  **Paste Text**: In the "Paste Text" box, paste your data that follows a structured format (e.g., `Question 1... Correct answer: ...`).
2.  **Paste JSON**: In the "Paste JSON" box, paste the raw JSON array. The tool is smart enough to find the JSON array even if it's surrounded by other text.
3.  **Process Data**: Click the "Process Data" button. The application will parse the text, identify missing questions, send the corresponding JSON entries to the Gemini API for cleaning, and merge everything.
4.  **Get Your Result**: The cleaned and unified data will appear in the "Result" section. You can then use the **Copy** button to copy it to your clipboard or the **Download** button to save it as a file.


Created by **Patryk Nowicki**
