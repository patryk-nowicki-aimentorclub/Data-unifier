
import React, { useState, useCallback } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { JsonQuestion, ParsedTextQuestion, FinalResultItem } from './types';
import { UploadIcon, CopyIcon, DownloadIcon, CheckIcon, CodeBracketIcon, ChevronDownIcon } from './components/icons';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const scriptContent = `// AUTO: clicks the 1st answer, proceeds, and SAVES {question, answer},
// enhanced detection of "narrow" options + fallback + no stopping on difficult questions
(async () => {
  const S = ms => new Promise(r => setTimeout(r, ms));
  const PACE = { afterSelect: 450, afterCheck: 350, afterNext: 700, poll: 120, waitMax: 12000 };

  const $$  = sel => Array.from(document.querySelectorAll(sel));
  const txt = el => (el?.innerText || el?.textContent || '').trim();
  const vis = el => el && el.offsetParent && getComputedStyle(el).visibility!=='hidden' && getComputedStyle(el).display!=='none';

  // full click simulation
  const realClick = async (el) => {
    if (!el) return false;
    try {
      el.scrollIntoView({block:'center'});
      const r = el.getBoundingClientRect();
      const common = { bubbles:true, cancelable:true, view:window, clientX:r.left+r.width/2, clientY:r.top+r.height/2 };
      el.dispatchEvent(new PointerEvent('pointerdown', common));
      el.dispatchEvent(new MouseEvent('mousedown', common));
      el.dispatchEvent(new PointerEvent('pointerup', common));
      el.dispatchEvent(new MouseEvent('mouseup', common));
      el.click();
      return true;
    } catch { try { el.click(); return true; } catch { return false; } }
  };

  const getProgress = () => {
    const m = $$('body *').map(e => (e.innerText||'').match(/Wybierz\\s*:\\s*(\\d+)\\s*\\/\\s*(\\d+)/i)).find(Boolean);
    return m ? { idx:+m[1], total:+m[2] } : null;
  };

  // question content (largest text block in the middle of the screen)
  function questionText() {
    const H = innerHeight, top = H*0.10, bottom = H*0.85;
    const blocks = $$('main * , body *')
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.top>top && r.bottom<bottom && vis(el);
      })
      .map(el => txt(el))
      .filter(s => s && s.length>25 && s.length<1600)
      .sort((a,b)=>b.length-a.length);
    return (blocks[0]||'').trim();
  }

  // ——— ENHANCED OPTION SEARCH ———
  function findOptions() {
    const footer = $$('body *').find(e => /Wybierz\\s*:\\s*\\d+\\s*\\/\\s*\\d+/i.test(txt(e)));
    const fTop = footer ? footer.getBoundingClientRect().top : innerHeight*0.90;
    const W = innerWidth, H = innerHeight;

    // 1) loose heuristic: grab buttons/labels above the footer, even narrow ones
    const widthMin = Math.min(220, W*0.25); // was 360 / 0.44 – too strict for narrow cards
    let cand = $$('button,[role="button"],label')
      .filter(vis)
      .map(el => ({ el, r: el.getBoundingClientRect(), s: txt(el) }))
      .filter(x =>
        x.r.top > H*0.12 && x.r.bottom < fTop - 8 &&
        x.r.height >= 28 && x.s.length >= 1 && x.s.length <= 300 &&
        !/kliknij/i.test(x.s) &&
        x.r.width >= widthMin // we also allow narrower ones (e.g., "Correct.", "Incorrect.")
      )
      .sort((a,b)=> a.r.top - b.r.top);

    // 2) group by column (left offset ~ constant)
    if (cand.length) {
      const groups = [];
      for (const c of cand) {
        let g = groups.find(g => Math.abs(g.left - c.r.left) <= 24); // wider tolerance
        if (!g) groups.push(g = { left:c.r.left, items:[] });
        g.items.push(c);
      }
      groups.sort((a,b)=> b.items.length - a.items.length);
      const best = groups[0]?.items || [];
      // if very few (<=2), try adding elements from the second group (sometimes "A" and the rest are two groups)
      const merged = best.length >= 3 ? best
                    : [...best, ...((groups[1]?.items)||[])].sort((a,b)=>a.r.top-b.r.top);
      cand = merged;
    }

    // 3) Fallback: if still empty, just take the first 5 buttons above the footer (without icons)
    if (!cand.length) {
      cand = $$('button,[role="button"],label')
        .filter(vis)
        .map(el => ({ el, r: el.getBoundingClientRect(), s: txt(el) }))
        .filter(x => x.r.top > H*0.12 && x.r.bottom < fTop - 8 && x.s && x.s.length <= 300)
        .sort((a,b)=> a.r.top - b.r.top)
        .slice(0,5);
    }

    return cand.map(x => x.el);
  }

  function findNext() {
    const icon = $$('button').find(b => b.querySelector('svg.lucide-arrow-right,[class*="arrow-right"],use[href*="arrow-right"]'));
    if (icon && vis(icon)) return icon;
    const byText = $$('button,[role="button"],a').find(el => vis(el) && /(dalej|następ|nastep|next|zakończ|zakoncz)/i.test(txt(el).toLowerCase()));
    if (byText) return byText;
    const cands = $$('button,[role="button"],a').filter(vis).map(el=>({el,r:el.getBoundingClientRect()}))
      .filter(x => x.r.top > innerHeight*0.72 && x.r.width >= 36 && x.r.height >= 30)
      .sort((a,b)=> (a.r.right-b.r.right) || (b.r.top-a.r.top));
    return cands.pop()?.el || null;
  }

  async function waitAdvance(oldIdx, oldText) {
    const t0 = Date.now();
    while (Date.now() - t0 < PACE.waitMax) {
      await S(PACE.poll);
      const pr = getProgress();
      if (oldIdx && pr && pr.idx === oldIdx + 1) return true;
      const q = questionText();
      if (q && q !== oldText) return true;
    }
    return false;
  }

  // collecting results
  const dump = [];
  const saveJSON = (name, data) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
    a.download = name; a.click();
  };
  const slug  = (location.pathname.match(/\\/lek\\/([^/?#]+)/)||[])[1] || 'unknown';
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');

  // "Start test" if visible
  const startBtn = $$('button,[role="button"],a').find(el => vis(el) && /(rozpocznij|start|begin|test)/i.test(txt(el).toLowerCase()));
  if (startBtn) { await realClick(startBtn); await S(700); }

  let safety = 0;
  while (true) {
    await S(200);

    const pr    = getProgress();
    const qText = questionText();
    let   opts  = findOptions();
    let   next  = findNext();

    // if a difficult layout: don't stop – try to proceed, saving answer:null
    if (!next) next = findNext(); // second attempt
    if (!qText) { console.warn('⚠️ no question content'); }

    let answerText = null;
    if (opts.length) {
      answerText = txt(opts[0]) || null;
      await realClick(opts[0]);
      await S(PACE.afterSelect);
      const check = $$('button,[role="button"],a').find(el => vis(el) && /(sprawdź|sprawdz|zatwierdź|zatwierdz|pokaż|pokaz|check|submit)/i.test(txt(el).toLowerCase()));
      if (check) { await realClick(check); await S(PACE.afterCheck); }
    } else {
      console.warn('⚠️ I didn\\'t find options in this question – saving answer:null and moving on');
    }

    dump.push({
      index: pr?.idx ?? dump.length + 1,
      question: qText || '(no question content detected)',
      answer: answerText
    });

    if (!next) { console.warn('⚠️ no "Next" button – ending loop'); break; }

    const oldIdx  = pr?.idx || null;
    const oldText = qText || '';

    await realClick(next);
    await S(PACE.afterNext);
    let moved = await waitAdvance(oldIdx, oldText);

    if (!moved) {
      next = findNext() || next;
      await realClick(next);
      await S(PACE.afterNext + 200);
      moved = await waitAdvance(oldIdx, oldText);
    }
    if (!moved) {
      window.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', code:'ArrowRight', bubbles:true}));
      await S(PACE.afterNext + 200);
      moved = await waitAdvance(oldIdx, oldText);
    }
    if (!moved) { console.warn('⏳ question hasn\\'t changed — stop'); break; }

    if (++safety > 2000) break; // safety break
  }

  const fileName = 'lek_' + slug + '_' + stamp + '_q+a.json';
  saveJSON(fileName, { category: slug, count: dump.length, items: dump });
  console.log('🏁 end — saved', dump.length, 'questions to', fileName);
})();
`;


const App: React.FC = () => {
    const [textInput, setTextInput] = useState<string>('');
    const [jsonStringInput, setJsonStringInput] = useState<string>('');
    const [result, setResult] = useState<string>('');
    const [error, setError] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isCopied, setIsCopied] = useState<boolean>(false);
    const [isScriptVisible, setIsScriptVisible] = useState<boolean>(false);
    const [isScriptCopied, setIsScriptCopied] = useState<boolean>(false);


    const cleanTextString = (str: string): string => {
        return str.replace(/\\n/g, ' ').replace(/\\s+/g, ' ').trim();
    };

    const cleanWithAi = async (questions: JsonQuestion[]): Promise<FinalResultItem[]> => {
        const schema = {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                index: {
                  type: Type.INTEGER,
                  description: 'The original index of the question.',
                },
                pytanie: {
                  type: Type.STRING,
                  description: 'The cleaned question text.',
                },
                odpowiedz: {
                  type: Type.STRING,
                  description: 'The cleaned answer text.',
                },
              },
              required: ['index', 'pytanie', 'odpowiedz'],
              propertyOrdering: ['index', 'pytanie', 'odpowiedz'],
            },
        };

        const prompt = `
You are a precise assistant for medical data extraction. Your task is to process JSON objects containing exam questions and return clean, correctly formatted data.

For each object in the JSON array, follow these steps:
1.  **Extract the question**: In the 'question' field, find and extract **only** the text that constitutes the medical question or case description.
    *   **Start of question**: The question usually begins after various "junk" data (e.g., "Mark...", "0 min", page counters). Find the beginning of the actual medical description.
    *   **End of question**: The question text ends **immediately before** the list of multiple-choice answers begins. This list might start with \`A\\n\`, \`B\\n\`, \`1)\`, \`2)\`, \`A)\`, \`B)\`. **Do not include any answer options in the extracted question.**
    *   Ignore everything else, such as headers, navigation elements, footers, and phrases like "Choose:", "The correct answer is:".

2.  **Extract the answer**: In the 'answer' field, remove only the leading letter/character and newline (e.g., "A\\n", "B\\n", "C. "). Keep the rest of the answer text unchanged.

**Example of how to do it:**

**INPUT:**
{
  "index": 1,
  "question": "Zaznacz, jeśli już znasz\\nodpowiedź na to pytanie\\n\\n0 min\\nKliknij --->\\n0\\n1\\n\\nKobieta lat 52, przyjmuje doustne preparaty żelaza z powodu nieznacznej niedokrwistości mikrocytarnej - zgłasza obfite miesiączki. Dodatkowo lekarz zalecił wykonanie trzykrotne testu gwajakolowego na obecność krwi utajonej w kale - wyniki dodatnie*. U tej pacjentki należy w pierwszej kolejności:\\n\\nA\\nwykonać kolonoskopię.\\nB\\nPowtórzyć test po odstawieniu preparatów żelaza\\nC\\nwyeliminować chorobę trzewną\\nD\\nzalecić dietę z eliminacją dużych dawek witaminy C i powtórzyć badanie\\nE\\nuzależnić decyzję od objawów ze strony przewodu.\\nWybierz:\\n/476",
  "answer": "A\\nwykonać kolonoskopię."
}

**THOUGHT PROCESS:**
1.  **Analyze 'question'**: I'll ignore the initial noise. I find the text "Kobieta lat 52... należy w pierwszej kolejności:". This is my question.
2.  **Find end of question**: I see that right after ":" the option "A\\nwykonać kolonoskopię." begins. Therefore, the question text ends at ":". I will not include options A, B, C, D, E.
3.  **Analyze 'answer'**: I see "A\\nwykonać kolonoskopię.". I remove the "A\\n" from the front to get the clean answer text.

**EXPECTED OUTPUT:**
{
  "index": 1,
  "pytanie": "Kobieta lat 52, przyjmuje doustne preparaty żelaza z powodu nieznacznej niedokrwistości mikrocytarnej - zgłasza obfite miesiączki. Dodatkowo lekarz zalecił wykonanie trzykrotne testu gwajakolowego na obecność krwi utajonej w kale - wyniki dodatnie*. U tej pacjentki należy w pierwszej kolejności:",
  "odpowiedz": "wykonać kolonoskopię."
}

Now, apply the same precise process to the following data array:
${JSON.stringify(questions, null, 2)}
`;
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: schema,
                    temperature: 0.1,
                },
            });
    
            const cleanedText = response.text.trim();
            const cleanedData = JSON.parse(cleanedText);
            return cleanedData as FinalResultItem[];
        } catch (e) {
            console.error("AI Error:", e);
            throw new Error("Failed to process data with AI. Check the console for more information.");
        }
    }
    
    const processData = useCallback(async () => {
        if (!textInput.trim() && !jsonStringInput.trim()) {
            setError('Please paste text or JSON data before processing.');
            return;
        }

        setIsLoading(true);
        setError('');
        setResult('');

        try {
            // Process Text Input
            const parsedTextData = new Map<number, ParsedTextQuestion>();
            if (textInput.trim()) {
                const questionBlocks = textInput.split(/(?=Pytanie \d+)/).filter(block => block.trim() !== '');

                for (const block of questionBlocks) {
                    const indexMatch = block.match(/^Pytanie (\d+)/);
                    if (indexMatch) {
                        const index = parseInt(indexMatch[1], 10);
                        const lines = block.split('\\n').filter(line => line.trim() !== '');

                        const answerLineIndex = lines.findIndex(line => line.toLowerCase().includes('poprawna odpowiedź:'));

                        if (answerLineIndex !== -1) {
                            const answerLine = lines[answerLineIndex];
                            const answers = [cleanTextString(answerLine.replace(/.*poprawna odpowiedź:/i, ''))];

                            let questionEndLineIndex = lines.findIndex(line => line.toLowerCase().includes('twoja odpowiedź:'));
                            if (questionEndLineIndex === -1 || questionEndLineIndex > answerLineIndex) {
                                questionEndLineIndex = answerLineIndex;
                            }
                            
                            const questionLines = lines.slice(0, questionEndLineIndex);
                            
                            if (questionLines.length > 0) {
                                 questionLines[0] = questionLines[0].replace(/^Pytanie \d+\\s*:?\\s*/, '').trim();
                            }

                            const question = cleanTextString(questionLines.join(' '));
                            
                            if (question && answers.length > 0 && answers[0]) {
                                parsedTextData.set(index, { question, answers });
                            }
                        }
                    }
                }
            }
            
            // Process JSON Input
            let jsonInput: JsonQuestion[] = [];
            let jsonIndexMap = new Map<number, JsonQuestion>();
            
            if (jsonStringInput.trim()) {
                try {
                    let jsonToParse = jsonStringInput.trim();
                    const startIndex = jsonToParse.indexOf('[');
                    const lastIndex = jsonToParse.lastIndexOf(']');

                    if (startIndex > -1 && lastIndex > startIndex) {
                        jsonToParse = jsonToParse.substring(startIndex, lastIndex + 1);
                    }
                    
                    jsonInput = JSON.parse(jsonToParse);
                    if (!Array.isArray(jsonInput) || (jsonInput.length > 0 && !jsonInput.every(item => 'index' in item && 'question' in item && 'answer' in item))) {
                        throw new Error("Invalid JSON data structure.");
                    }
                    jsonIndexMap = new Map<number, JsonQuestion>(jsonInput.map(item => [item.index, item]));
                } catch (err) {
                     setError('Error parsing JSON. Please ensure it has the correct format. An attempt was made to automatically extract the JSON array, but it failed.');
                     setIsLoading(false);
                     return;
                }
            }

            const textIndices = Array.from(parsedTextData.keys());
            const jsonIndices = Array.from(jsonIndexMap.keys());
            const maxIndex = Math.max(0, ...textIndices, ...jsonIndices);


            const itemsToProcessWithAI: JsonQuestion[] = [];
            for (let i = 1; i <= maxIndex; i++) {
                if (!parsedTextData.has(i) && jsonIndexMap.has(i)) {
                    itemsToProcessWithAI.push(jsonIndexMap.get(i)!);
                }
            }

            let aiCleanedDataMap = new Map<number, FinalResultItem>();
            if (itemsToProcessWithAI.length > 0) {
                const cleanedItems = await cleanWithAi(itemsToProcessWithAI);
                aiCleanedDataMap = new Map(cleanedItems.map(item => [item.index, item]));
            }

            const finalData: FinalResultItem[] = [];
            for (let i = 1; i <= maxIndex; i++) {
                if (parsedTextData.has(i)) {
                    const textData = parsedTextData.get(i)!;
                    finalData.push({
                        index: i,
                        pytanie: textData.question,
                        odpowiedz: textData.answers.join('; ')
                    });
                } else if (aiCleanedDataMap.has(i)) {
                    finalData.push(aiCleanedDataMap.get(i)!);
                }
            }
            
            setResult(JSON.stringify(finalData, null, 2));

        } catch (err) {
            setError(`An unexpected error occurred: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setIsLoading(false);
        }

    }, [textInput, jsonStringInput]);

    const handleCopyToClipboard = () => {
        if (result) {
            navigator.clipboard.writeText(result).then(() => {
                setIsCopied(true);
                setTimeout(() => setIsCopied(false), 2000);
            });
        }
    };

    const handleCopyScript = () => {
        navigator.clipboard.writeText(scriptContent).then(() => {
            setIsScriptCopied(true);
            setTimeout(() => setIsScriptCopied(false), 2000);
        });
    };

    const handleDownload = () => {
        if (result) {
            const blob = new Blob([result], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'unified_data.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 text-slate-200 font-sans p-4 sm:p-6 lg:p-8">
            <div className="max-w-4xl mx-auto">
                <header className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-indigo-400">Data Unifier</h1>
                    <p className="text-slate-400 mt-2">A tool to merge and clean data from text and a JSON file into one cohesive format.</p>
                </header>

                <div className="mb-6 bg-slate-800 rounded-lg shadow-lg">
                    <button
                        onClick={() => setIsScriptVisible(!isScriptVisible)}
                        className="w-full flex justify-between items-center p-4 text-left font-semibold text-indigo-400 hover:bg-slate-700/50 rounded-lg transition duration-200"
                        aria-expanded={isScriptVisible}
                    >
                        <span className="flex items-center gap-3">
                            <CodeBracketIcon className="w-6 h-6"/>
                            Auto-Solver & Scraper Script
                        </span>
                        <ChevronDownIcon className={`w-5 h-5 transition-transform duration-300 ${isScriptVisible ? 'rotate-180' : ''}`} />
                    </button>
                    {isScriptVisible && (
                        <div className="p-4 border-t border-slate-700">
                            <p className="text-slate-400 mb-4">
                                This script automates the process of answering questions on a test website. It clicks the first answer, proceeds to the next question, and at the end, it compiles and downloads a JSON file containing all the questions and the selected answers.
                            </p>
                            <h3 className="font-semibold text-slate-300 mb-2">How to use:</h3>
                            <ol className="list-decimal list-inside text-slate-400 space-y-1 mb-4">
                                <li>Navigate to the online test page in your browser.</li>
                                <li>Open the Developer Console (press F12, or Ctrl+Shift+I, or right-click and "Inspect").</li>
                                <li>Go to the "Console" tab.</li>
                                <li>Click the "Copy" button below and paste the script into the console.</li>
                                <li>Press Enter to run the script. It will run automatically.</li>
                                <li>When it's finished, a JSON file will be downloaded to your computer.</li>
                            </ol>
                            <div className="relative bg-slate-900 rounded-md">
                                <button 
                                    onClick={handleCopyScript}
                                    className="absolute top-2 right-2 flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1 rounded-md text-sm transition"
                                    title="Copy Script"
                                >
                                   {isScriptCopied ? <CheckIcon className="w-4 h-4 text-green-400" /> : <CopyIcon className="w-4 h-4" />}
                                   {isScriptCopied ? 'Copied!' : 'Copy'}
                                </button>
                                <pre className="text-sm text-slate-300 p-4 rounded-md max-h-80 overflow-auto">
                                    <code>{scriptContent}</code>
                                </pre>
                            </div>
                        </div>
                    )}
                </div>

                <main>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                        <div className="bg-slate-800 p-6 rounded-lg shadow-lg">
                            <label htmlFor="text-input" className="block text-lg font-semibold mb-2 text-indigo-400">1. Paste Text</label>
                            <textarea
                                id="text-input"
                                value={textInput}
                                onChange={(e) => setTextInput(e.target.value)}
                                placeholder="Paste your text here in the format: Question X, Your answer:, Correct answer:..."
                                className="w-full h-96 bg-slate-900 border border-slate-700 rounded-md p-3 text-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition duration-200 resize-y"
                                aria-label="Text input for text-formatted data"
                            />
                        </div>

                         <div className="bg-slate-800 p-6 rounded-lg shadow-lg">
                            <label htmlFor="json-input" className="block text-lg font-semibold mb-2 text-indigo-400">2. Paste JSON</label>
                            <textarea
                                id="json-input"
                                value={jsonStringInput}
                                onChange={(e) => setJsonStringInput(e.target.value)}
                                placeholder='Paste your JSON here in the format: [{"index": 1, "question": "...", "answer": "..."}, ...]'
                                className="w-full h-96 bg-slate-900 border border-slate-700 rounded-md p-3 text-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition duration-200 resize-y"
                                aria-label="Text input for JSON-formatted data"
                            />
                        </div>
                    </div>

                    <div className="text-center my-8">
                        <button
                            onClick={processData}
                            disabled={isLoading}
                            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold py-3 px-8 rounded-full shadow-lg transform hover:scale-105 transition duration-300 ease-in-out"
                        >
                            {isLoading ? "Processing..." : "Process Data"}
                        </button>
                    </div>

                    {error && (
                        <div role="alert" className="bg-red-900/50 border border-red-700 text-red-300 p-4 rounded-lg text-center mb-6">
                            {error}
                        </div>
                    )}

                    {result && (
                        <div className="bg-slate-800 p-6 rounded-lg shadow-lg">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-2xl font-semibold text-indigo-400">Result</h2>
                                <div className="flex items-center gap-4">
                                    <button onClick={handleCopyToClipboard} className="flex items-center gap-2 text-slate-300 hover:text-indigo-400 transition duration-200" title="Copy to clipboard">
                                        {isCopied ? <CheckIcon className="w-5 h-5 text-green-400" /> : <CopyIcon className="w-5 h-5" />}
                                        <span>{isCopied ? "Copied!" : "Copy"}</span>
                                    </button>
                                    <button onClick={handleDownload} className="flex items-center gap-2 text-slate-300 hover:text-indigo-400 transition duration-200" title="Download JSON file">
                                        <DownloadIcon className="w-5 h-5" />
                                        <span>Download</span>
                                    </button>
                                </div>
                            </div>
                            <pre className="bg-slate-900 text-sm text-slate-300 p-4 rounded-md max-h-96 overflow-auto">
                                <code role="region" aria-label="Result in JSON format">{result}</code>
                            </pre>
                        </div>
                    )}
                </main>
                <footer className="text-center mt-8 text-slate-500 text-sm">
                    Created by Patryk Nowicki
                </footer>
            </div>
        </div>
    );
};

export default App;
