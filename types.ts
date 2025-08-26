
export interface JsonQuestion {
  index: number;
  question: string;
  answer: string;
}

export interface ParsedTextQuestion {
  question: string;
  answers: string[];
}

export interface FinalResultItem {
  index: number;
  pytanie: string;
  odpowiedz: string;
}
