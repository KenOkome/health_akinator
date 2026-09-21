/**
 * ヘルス・アキネーター（Health Akinator）メインロジック
 */

class HealthAkinatorApp {
    constructor() {
        this.currentPhase = 0; // 0: 主訴入力, 1: 質問中, 2: 結果表示
        this.categoryKey = null;
        this.categoryData = null;
        this.activeQuestions = [];
        this.askedQuestionIds = new Set();
        this.currentQuestionIdx = 0;
        this.minQuestions = 2;
        this.maxQuestions = 5;
        this.answers = {};
        this.conversationHistory = []; // AI対話履歴
        this.userNotes = [];

        // URLパラメータまたはハッシュ(#key=...)からのワンタップキー登録
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const hashKey = window.location.hash.startsWith("#key=") ? decodeURIComponent(window.location.hash.substring(5)) : null;
            const paramKey = urlParams.get("key") || hashKey;
            if (paramKey && paramKey.trim()) {
                localStorage.setItem("gemini_api_key", paramKey.trim());
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        } catch (e) {
            console.warn("URL key parse error:", e);
        }

        this.geminiApiKey = localStorage.getItem("gemini_api_key") || "";
        let savedModel = localStorage.getItem("gemini_model") || "gemini-3.5-flash-lite";
        // 旧世代モデル（1.5系、2.0系）が残っている場合はGemini 3系へ自動移行
        if (!savedModel.startsWith("gemini-3")) {
            savedModel = "gemini-3.5-flash-lite";
            localStorage.setItem("gemini_model", savedModel);
        }
        this.geminiModel = savedModel;
        this.isAiMode = !!this.geminiApiKey;

        this.genieQuotes = [
            "あなたの体の声、少しずつ見えてきましたよ…",
            "ふむ…なるほど。その症状がポイントですね…",
            "ほう…私の推論の霧が、少しずつ晴れてきました…",
            "フフフ…体のサインは嘘をつきませんよ…",
            "あと少しです…核心に近づいています…！"
        ];

        this.initDOM();
        this.bindEvents();
        this.updateAiModeBadge();
    }

    initDOM() {
        this.elGenieContainer = document.getElementById("genieContainer");
        this.elGenieSpeech = document.getElementById("genieSpeech");
        this.elPhase0 = document.getElementById("phase0");
        this.elPhase1 = document.getElementById("phase1");
        this.elPhase2 = document.getElementById("phase2");

        // フェーズ0 要素
        this.elSymptomInput = document.getElementById("symptomInput");
        this.elBtnStart = document.getElementById("btnStart");
        this.elQuickBtns = document.querySelectorAll(".btn-quick");

        // フェーズ1 要素
        this.elQuestionBadge = document.getElementById("questionBadge");
        this.elProgressFill = document.getElementById("progressFill");
        this.elQuestionText = document.getElementById("questionText");
        this.elAnswerOptions = document.getElementById("answerOptions");
        this.elCustomAnswer = document.getElementById("customAnswerInput");
        this.elBtnCustomAnswer = document.getElementById("btnCustomAnswer");

        // フェーズ2 要素
        this.elProbList = document.getElementById("probabilityList");
        this.elDeptContent = document.getElementById("deptContent");
        this.elOtcContent = document.getElementById("otcContent");
        this.elFoodContent = document.getElementById("foodContent");
        this.elQuickCareContent = document.getElementById("quickCareContent");
        this.elPreventionContent = document.getElementById("preventionContent");
        this.elBtnRestart = document.getElementById("btnRestart");
        this.elBtnBoost = document.getElementById("btnBoost");

        // モーダル
        this.elEmergencyModal = document.getElementById("emergencyModal");
        this.elEmergencyMsg = document.getElementById("emergencyMsg");
        this.elBtnEmergencyClose = document.getElementById("btnEmergencyClose");

        this.elSettingsModal = document.getElementById("settingsModal");
        this.elBtnSettings = document.getElementById("btnSettings");
        this.elBtnSaveSettings = document.getElementById("btnSaveSettings");
        this.elCloseSettings = document.getElementById("btnCloseSettings");
        this.elBtnClearApiKey = document.getElementById("btnClearApiKey");
        this.elApiKeyInput = document.getElementById("apiKeyInput");
        this.elModelSelect = document.getElementById("modelSelect");
        if (this.elApiKeyInput) this.elApiKeyInput.value = this.geminiApiKey;
        if (this.elModelSelect) this.elModelSelect.value = this.geminiModel;

        this.elLogoHome = document.getElementById("btnLogoHome");
        this.elAiBadge = document.getElementById("aiModeBadge");
    }

    updateAiModeBadge() {
        if (!this.elAiBadge) return;
        if (this.geminiApiKey) {
            const modelNameMap = {
                "gemini-3.5-flash-lite": "Gemini 3.5 Lite",
                "gemini-3.5-flash": "Gemini 3.5 Flash",
                "gemini-3.1-flash-lite": "Gemini 3.1 Lite",
                "gemini-3.8-flash": "Gemini 3.8 Flash"
            };
            const label = modelNameMap[this.geminiModel] || this.geminiModel;
            this.elAiBadge.innerHTML = `⚡ <strong>${label} モード</strong>`;
            this.elAiBadge.className = "ai-badge active";
            this.elAiBadge.title = `${label} とリアルタイム通信中：あらゆる症状に完全に適応します`;
        } else {
            this.elAiBadge.innerHTML = "💡 <strong>スマート適応モード</strong>（キー未設定）";
            this.elAiBadge.className = "ai-badge";
            this.elAiBadge.title = "設定からGemini APIキーを登録すると完全なAI対話モードが有効になります";
        }
    }

    bindEvents() {
        // 左上ロゴタップで最初に戻る
        if (this.elLogoHome) {
            this.elLogoHome.addEventListener("click", () => {
                this.resetApp();
            });
            this.elLogoHome.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    this.resetApp();
                }
            });
        }

        // クイック主訴ボタン
        this.elQuickBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                const category = btn.dataset.category;
                const text = btn.querySelector("span:not(.icon)").textContent;
                this.startDiagnosis(category, text);
            });
        });

        // 自由入力スタート
        this.elBtnStart.addEventListener("click", () => {
            const text = this.elSymptomInput.value.trim();
            if (!text) {
                alert("気になる症状を入力してください。");
                return;
            }
            if (this.checkRedFlags(text)) return;
            const category = detectCategoryFromText(text);
            this.startDiagnosis(category, text);
        });

        this.elSymptomInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") this.elBtnStart.click();
        });

        // 自由記述回答
        this.elBtnCustomAnswer.addEventListener("click", () => {
            const text = this.elCustomAnswer.value.trim();
            if (!text) return;
            if (this.checkRedFlags(text)) return;
            this.handleAnswer("自由回答: " + text);
            this.elCustomAnswer.value = "";
        });

        this.elCustomAnswer.addEventListener("keydown", (e) => {
            if (e.key === "Enter") this.elBtnCustomAnswer.click();
        });

        // もう一度診断
        this.elBtnRestart.addEventListener("click", () => {
            this.resetApp();
        });

        // さらに精度を上げる（+5問追加）
        this.elBtnBoost.addEventListener("click", () => {
            this.boostQuestions();
        });

        // 緊急モーダル閉じる
        this.elBtnEmergencyClose.addEventListener("click", () => {
            this.elEmergencyModal.style.display = "none";
            this.resetApp();
        });

        // 設定モーダル
        this.elBtnSettings.addEventListener("click", () => {
            this.elSettingsModal.style.display = "flex";
        });
        if (this.elCloseSettings) {
            this.elCloseSettings.addEventListener("click", () => {
                this.elSettingsModal.style.display = "none";
            });
        }
        this.elBtnSaveSettings.addEventListener("click", () => {
            this.geminiApiKey = this.elApiKeyInput.value.trim();
            if (this.elModelSelect) {
                this.geminiModel = this.elModelSelect.value;
                localStorage.setItem("gemini_model", this.geminiModel);
            }
            localStorage.setItem("gemini_api_key", this.geminiApiKey);
            this.isAiMode = !!this.geminiApiKey;
            this.updateAiModeBadge();
            this.elSettingsModal.style.display = "none";
            alert(this.isAiMode ? `✨ Gemini AIモード（${this.geminiModel}）が有効化されました！` : "設定を保存しました（スマート適応モード）。");
        });

        if (this.elBtnClearApiKey) {
            this.elBtnClearApiKey.addEventListener("click", () => {
                this.geminiApiKey = "";
                localStorage.removeItem("gemini_api_key");
                if (this.elApiKeyInput) this.elApiKeyInput.value = "";
                this.isAiMode = false;
                this.updateAiModeBadge();
                this.elSettingsModal.style.display = "none";
                alert("APIキーを解除しました。内蔵のスマート適応モード（回数無制限）で動作します！");
            });
        }
    }

    // レッドフラッグ（緊急症状）検知
    checkRedFlags(text) {
        for (const rf of RED_FLAGS) {
            if (rf.pattern.test(text)) {
                this.showEmergency(rf.message);
                return true;
            }
        }
        return false;
    }

    showEmergency(msg) {
        this.elGenieContainer.className = "genie-avatar-container danger";
        this.elEmergencyMsg.textContent = msg;
        this.elEmergencyModal.style.display = "flex";
        this.setGenieSpeech("⚠️ 緊急の危険な症状の兆候を検知しました！ただちに安全を確保してください！");
    }

    // 診断開始
    async startDiagnosis(categoryKey, initialSymptom) {
        this.elGenieContainer.className = "genie-avatar-container";
        this.categoryKey = categoryKey;
        this.categoryData = KNOWLEDGE_BASE[categoryKey] || KNOWLEDGE_BASE.headache;
        this.activeQuestions = [...this.categoryData.primaryQuestions];
        this.askedQuestionIds.clear();
        this.currentQuestionIdx = 0;
        this.minQuestions = 2;
        this.maxQuestions = 5;
        this.answers = {};
        this.conversationHistory = [];
        this.userNotes = [initialSymptom];

        this.currentPhase = 1;
        this.elPhase0.style.display = "none";
        this.elPhase1.style.display = "block";
        this.elPhase2.style.display = "none";

        if (this.isAiMode) {
            // Gemini AIモード：AIに最初の質問を生成させる
            this.setGenieSpeech("あなたの体の声、少しずつ探らせていただきましょう…（AI分析中）");
            await this.askGeminiNextQuestion(`気になる症状（主訴）：${initialSymptom}`);
        } else {
            // スマート適応モード：主訴に応じた第1問
            this.setGenieSpeech(`「${initialSymptom}」ですね…！あなたの体の声、少しずつ探らせていただきましょう！`);
            this.renderAdaptiveQuestion();
        }
    }

    // スマート適応型：回答履歴に応じて最も適切な次の質問を選択
    getNextAdaptiveQuestion() {
        const pool = this.activeQuestions.filter(q => !this.askedQuestionIds.has(q.id));
        if (pool.length === 0) return null;

        let bestQ = pool[0];
        let bestScore = -1;

        for (const q of pool) {
            let score = 10; // ベーススコア

            // 頭痛の適応ロジック
            if (this.answers.h1 === "ズキズキ脈打つ" && ["h2", "h3", "h6", "h7", "h10", "h18", "h19"].includes(q.id)) score += 25;
            if (this.answers.h1 === "締め付けられる" && ["h4", "h5", "h9", "h12", "h15", "h17"].includes(q.id)) score += 25;
            if (this.answers.h2 === "はい" && ["h6", "h7"].includes(q.id)) score += 15;
            if (this.answers.h4 === "はい" && ["h5", "h12"].includes(q.id)) score += 15;

            // 胃痛の適応ロジック
            if (this.answers.s1 === "みぞおち（胃のあたり）" && ["s2", "s4", "s10", "s15"].includes(q.id)) score += 25;
            if (this.answers.s3 === "下痢がある" && ["s5", "s6"].includes(q.id)) score += 30;
            if (this.answers.s4 === "はい" && ["s2", "s12"].includes(q.id)) score += 25;

            // 風邪の適応ロジック
            if (this.answers.c1 === "38.0度以上の高熱" && ["c2", "c3", "c7", "c18"].includes(q.id)) score += 30;
            if (this.answers.c4 === "強い痛みがある" && ["c11", "c19"].includes(q.id)) score += 25;

            // 疲労の適応ロジック
            if (this.answers.f3 === "はい" && ["f6", "f12", "f13"].includes(q.id)) score += 25;
            if (this.answers.f2 === "寝ても疲れが取れない" && ["f4", "f7", "f11"].includes(q.id)) score += 20;

            if (score > bestScore) {
                bestScore = score;
                bestQ = q;
            }
        }

        return bestQ;
    }

    // 疾患スコアの現在値を計算（スマート適応モード用）
    calculateCurrentTopDiseases() {
        if (!this.categoryData || !this.categoryData.diseases) return [];
        const scored = this.categoryData.diseases.map(d => ({
            ...d,
            score: d.condition(this.answers)
        }));
        scored.sort((a, b) => b.score - a.score);
        return scored;
    }

    // スマート適応モードの質問描画
    renderAdaptiveQuestion() {
        const q = this.getNextAdaptiveQuestion();
        if (!q) {
            this.showResults();
            return;
        }

        this.currentQuestion = q;
        this.askedQuestionIds.add(q.id);

        const qNum = this.currentQuestionIdx + 1;
        this.elQuestionBadge.textContent = `質問 ${qNum} / 最大${this.maxQuestions}問`;
        const progressPercent = Math.min(100, Math.round((qNum / this.maxQuestions) * 100));
        this.elProgressFill.style.width = `${progressPercent}%`;

        this.elQuestionText.textContent = q.text;

        this.elAnswerOptions.innerHTML = "";
        q.options.forEach((opt, idx) => {
            const btn = document.createElement("button");
            btn.className = "btn-answer";
            btn.innerHTML = `<span><strong>${idx + 1}.</strong> ${opt}</span> <span>👉</span>`;
            btn.addEventListener("click", () => {
                this.handleAnswer(opt);
            });
            this.elAnswerOptions.appendChild(btn);
        });

        if (qNum > 1 && qNum < this.maxQuestions) {
            const quote = this.genieQuotes[(qNum - 1) % this.genieQuotes.length];
            this.setGenieSpeech(quote);
        }
    }

    // 回答処理
    async handleAnswer(answerText) {
        // キャラクターの思考モーション発動
        this.elGenieContainer.classList.add("thinking");
        setTimeout(() => {
            this.elGenieContainer.classList.remove("thinking");
        }, 800);

        if (this.isAiMode) {
            // Gemini AIモードの回答送信
            this.currentQuestionIdx++;
            await this.askGeminiNextQuestion(`私の回答：${answerText}`);
        } else {
            // スマート適応モードの回答記録
            if (this.currentQuestion) {
                this.answers[this.currentQuestion.id] = answerText;
            }
            this.currentQuestionIdx++;

            // 2問以上回答済みの場合、確信度が高ければ早期に結果表示
            if (this.currentQuestionIdx >= this.minQuestions) {
                const scored = this.calculateCurrentTopDiseases();
                const topScore = scored[0]?.score || 0;
                const secondScore = scored[1]?.score || 0;
                if ((topScore >= 60 && (topScore - secondScore >= 20)) || this.currentQuestionIdx >= this.maxQuestions) {
                    this.showResults();
                    return;
                }
            }

            if (this.currentQuestionIdx < this.maxQuestions) {
                this.renderAdaptiveQuestion();
            } else {
                this.showResults();
            }
        }
    }

    // Gemini APIによる動的質問生成（2問以上、最大5問）
    async askGeminiNextQuestion(userMessage) {
        const qNum = this.currentQuestionIdx + 1;
        this.elQuestionBadge.textContent = `質問 ${Math.min(qNum, this.maxQuestions)} / 最大${this.maxQuestions}問`;
        this.elProgressFill.style.width = `${Math.min(100, Math.round((qNum / this.maxQuestions) * 100))}%`;

        // 読み込み中演出
        this.elQuestionText.innerHTML = '<span style="color: var(--accent-cyan);">🔮 Gemini AIが症状を分析中…</span>';
        this.elAnswerOptions.innerHTML = "";

        try {
            let prompt = "";
            if (qNum >= this.maxQuestions) {
                prompt = `現在の質問番号: ${qNum}問目（最大${this.maxQuestions}問に達しました）
ユーザーからの入力: ${userMessage}

【指示】
これで質問は終了です。これまでの対話内容（全${qNum}問）を総合的に深く分析し、type: "result" として最終推測結果をJSON形式で返してください。`;
            } else if (qNum < this.minQuestions) {
                prompt = `現在の質問番号: ${qNum}問目（全${this.minQuestions}〜${this.maxQuestions}問中の${qNum}問目）
ユーザーからの入力: ${userMessage}

【指示】
ユーザーの主訴に基づき、疾患の絞り込みを深めるための次の質問を生成してください。
まだ1問目ですので、結果（type: "result"）は出さず、必ず type: "question" として次の質問を返してください。`;
            } else {
                prompt = `現在の質問番号: ${qNum}問目（全${this.minQuestions}〜${this.maxQuestions}問中の${qNum}問目）
ユーザーからの入力: ${userMessage}

【指示】
これまでの文脈を踏まえ、疾患の可能性が十分に特定できた場合は type: "result" で最終結果を出力してください。
まだ判断材料が足りず絞り込みを深めたい場合は、type: "question" として次の質問を1つだけ返してください。`;
            }

            const res = await this.callGemini(prompt);

            // 対話履歴に追加
            this.conversationHistory.push({ role: "user", parts: [{ text: userMessage }] });
            this.conversationHistory.push({ role: "model", parts: [{ text: JSON.stringify(res) }] });

            if (qNum < this.minQuestions) {
                // 1問目：絶対にresultは出さない
                if (res.type === "result" || !res.question) {
                    const forceQRes = await this.callGemini(`まだ1問目です。2問以上質問を行う必要があります。結果は出さず、type: "question" で質問を返してください。`);
                    this.renderAiQuestion(forceQRes);
                } else {
                    this.renderAiQuestion(res);
                }
            } else if (qNum >= this.maxQuestions) {
                // 5問目に達した場合：必ずresult
                if (res.type === "result") {
                    this.showAiResults(res);
                } else {
                    const finalRes = await this.callGemini(`全${this.maxQuestions}問が完了しました。type: "result" として最終推測結果をJSONで出力してください。`);
                    this.showAiResults(finalRes);
                }
            } else {
                // 2〜4問目：AIがresultを出したら結果表示、questionを出したら質問継続
                if (res.type === "result") {
                    this.showAiResults(res);
                } else {
                    this.renderAiQuestion(res);
                }
            }
        } catch (err) {
            console.error("Gemini API error:", err);
            const errMsg = err.message || "";
            const isQuota = errMsg.includes("Quota exceeded") || errMsg.includes("rate-limits") || errMsg.includes("429");

            this.elAnswerOptions.innerHTML = "";

            if (isQuota) {
                // 秒数抽出（例: Please retry in 34.7s）
                const matchSec = errMsg.match(/retry in (\d+)/i);
                const waitSec = matchSec ? Math.ceil(Number(matchSec[1])) : 30;

                this.setGenieSpeech(`Google APIの無料枠制限に達しているようです。内蔵のスマート適応エンジンなら待ち時間ゼロで今すぐ診断できますぞ！`);
                this.elQuestionText.innerHTML = `
                    <div style="text-align: center; padding: 10px 0;">
                        <div style="font-size: 16px; color: #FBBF24; font-weight: 700; margin-bottom: 8px;">
                            ⏳ Google API 無料枠の利用上限（Quota Exceeded）
                        </div>
                        <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.6;">
                            本日のAPI無料枠上限に達しているため、APIからの応答が停止しています。<br>
                            下の <strong>「内蔵エンジンで続ける」</strong> を押すと、待ち時間なしですぐに診断を続行できます。
                        </div>
                    </div>
                `;

                // 内蔵エンジンで今すぐ続けるボタン（最優先）
                const btnFallback = document.createElement("button");
                btnFallback.className = "btn-answer";
                btnFallback.style.borderColor = "var(--accent-purple)";
                btnFallback.style.background = "linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(0, 229, 255, 0.2))";
                btnFallback.innerHTML = `<span>💡 <strong>内蔵エンジンで今すぐ診断を続ける（制限なし）</strong></span> <span>👉</span>`;
                btnFallback.addEventListener("click", () => {
                    this.isAiMode = false;
                    this.updateAiModeBadge();
                    this.renderAdaptiveQuestion();
                });
                this.elAnswerOptions.appendChild(btnFallback);

                // 再試行ボタン
                const btnRetry = document.createElement("button");
                btnRetry.className = "btn-answer";
                btnRetry.innerHTML = `<span>🔄 <strong>AI診断を再試行する</strong></span> <span>👉</span>`;
                btnRetry.addEventListener("click", () => {
                    this.askGeminiNextQuestion(userMessage);
                });
                this.elAnswerOptions.appendChild(btnRetry);
            } else {
                this.setGenieSpeech("通信が一時的に混み合っているようです。下のボタンから再試行するか、内蔵エンジンで続けられますぞ！");
                this.elQuestionText.innerHTML = `<span style="color: #F87171;">⚠️ 一時的な通信エラーが発生しました (${errMsg})</span>`;

                const btnFallback = document.createElement("button");
                btnFallback.className = "btn-answer";
                btnFallback.style.borderColor = "var(--accent-purple)";
                btnFallback.innerHTML = `<span>💡 <strong>内蔵エンジンで今すぐ診断を続ける（制限なし）</strong></span> <span>👉</span>`;
                btnFallback.addEventListener("click", () => {
                    this.isAiMode = false;
                    this.updateAiModeBadge();
                    this.renderAdaptiveQuestion();
                });
                this.elAnswerOptions.appendChild(btnFallback);

                const btnRetry = document.createElement("button");
                btnRetry.className = "btn-answer";
                btnRetry.innerHTML = `<span>🔄 <strong>AI診断を再試行する</strong></span> <span>👉</span>`;
                btnRetry.addEventListener("click", () => {
                    this.askGeminiNextQuestion(userMessage);
                });
                this.elAnswerOptions.appendChild(btnRetry);
            }
        }
    }

    renderAiQuestion(res) {
        if (res.speech) this.setGenieSpeech(res.speech);
        this.elQuestionText.textContent = res.question;

        const options = res.options || ["はい", "いいえ", "どちらともいえない"];
        this.elAnswerOptions.innerHTML = "";
        options.forEach((opt, idx) => {
            const btn = document.createElement("button");
            btn.className = "btn-answer";
            btn.innerHTML = `<span><strong>${idx + 1}.</strong> ${opt}</span> <span>👉</span>`;
            btn.addEventListener("click", () => this.handleAnswer(opt));
            this.elAnswerOptions.appendChild(btn);
        });
    }

    async callGemini(promptText, retryCount = 0) {
        const fallbackModels = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.1-flash-lite"];
        let model = this.geminiModel || "gemini-3.5-flash-lite";
        if (retryCount > 0 && retryCount <= fallbackModels.length) {
            model = fallbackModels[retryCount - 1];
        }
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiApiKey}`;
        const systemInstruction = `あなたは「ヘルス・アキネーター」です。ユーザーの症状に関する質問を1問ずつ行い、可能性のある一般的な病気や体調不良の原因を推測するAI助手です。
親切で丁寧でありつつ、「あなたの体の声、少しずつ見えてきましたよ…」といった、アキネーターを彷彿とさせる自信ありげでテンポの良い対話を行ってください。

【絶対厳守ルール】
1. 1ターンにつき質問は「絶対に1つだけ」。
2. 【質問数のルール：2問以上、最大5問まで（厳守）】
   - 1問目（質問1）では、どんなに病気が特定できたと思っても【絶対に結果（type: "result"）を出力してはいけません】。必ず疾患を絞り込むための質問を行ってください。
   - 2問目〜4問目では、十分な確信が得られた場合は type: "result" を出力して構いません。まだ絞り込みが必要な場合は type: "question" で次の質問を続けてください。
   - 5問目（質問5）の回答を受け取ったら、それ以上質問を続けず【必ず最終結果（type: "result"）】を出力してください。
3. 【質問文と選択肢の整合性】
   - 「Aですか？それともBですか？」のような二者択一や状態選択の質問をする場合、選択肢を「はい/いいえ」にするのは【絶対に禁止】です。必ず選択肢自体を「Aの症状」「Bの症状」「どちらでもない」のように具体的に設定してください。
   - 「〜はありますか？」のような有無を尋ねる質問の場合のみ、「はい」「いいえ」などの選択肢にしてください。
4. 【確率の合計は必ず100%】
   - 結果出力時（type: "result"）、diseases配列内の各疾患の probability の合計値は必ずピッタリ100（%）になるように配分してください（例：60%, 30%, 10%）。
5. レッドフラッグ（突然の激しい頭痛、激しい胸痛、意識障害、呼吸困難等）を検知した場合は即座に救急車（119番）を促してください。
6. 出力は必ず以下のJSON形式のみで返してください（Markdownのバッククォートjsonで囲む）。

【質問時のJSONフォーマット例（二者択一・状況選択のとき）】
{
  "type": "question",
  "speech": "なるほど、右の脇腹から鼠径部にかけての痛みですね…",
  "question": "その痛みは、突然激しく起こりましたか？それとも鈍い痛みがジワジワと続いていますか？",
  "options": ["突然激しく起こった", "鈍い痛みがジワジワ続いている", "どちらでもない / 分からない"]
}

【質問時のJSONフォーマット例（有無を問うとき）】
{
  "type": "question",
  "speech": "ふむ…痛みのサインが見えてきましたよ…",
  "question": "吐き気や発熱、血尿などの症状は伴っていますか？",
  "options": ["はい（伴っている）", "いいえ（伴っていない）", "どちらともいえない"]
}

【最終結果出力時のJSONフォーマット】（2問以上回答後、結果を出力する時）
{
  "type": "result",
  "speech": "見えましたよ…！あなたの回答から、私が推測した可能性はこちらです！",
  "diseases": [
    { "name": "疾患名1", "probability": 60, "reason": "理由・特徴" },
    { "name": "疾患名2", "probability": 30, "reason": "理由・特徴" },
    { "name": "疾患名3", "probability": 10, "reason": "理由・特徴" }
  ],
  "department": "おすすめ受診科",
  "otcDrug": "市販薬の目安",
  "food": "おすすめ食品・食事",
  "quickCare": "今すぐできる対策",
  "prevention": "今後の予防行動"
}`;

        const body = {
            contents: [
                ...this.conversationHistory,
                { role: "user", parts: [{ text: promptText }] }
            ],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.7
            }
        };

        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            const errMsg = errData.error?.message || `API Error: ${res.status}`;

            // 一時的な混雑（503, 429, 404, high demand等）の場合はフォールバックモデルで再試行
            const isTemporary = res.status === 503 || res.status === 429 || res.status === 404 || errMsg.includes("high demand") || errMsg.includes("temporarily unavailable") || errMsg.includes("no longer available");
            if (isTemporary && retryCount < fallbackModels.length) {
                const nextModel = fallbackModels[retryCount];
                console.warn(`モデル ${model} でエラー (${errMsg}) のため、${nextModel} に切り替えて再試行します (${retryCount + 1}/${fallbackModels.length})...`);
                this.setGenieSpeech("思考を集中させております…少々お待ちくだされ（モデル自動切替中）…");
                await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)));
                return await this.callGemini(promptText, retryCount + 1);
            }

            throw new Error(errMsg);
        }

        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        return JSON.parse(text);
    }

    // AI結果の描画
    showAiResults(res) {
        this.currentPhase = 2;
        this.elPhase0.style.display = "none";
        this.elPhase1.style.display = "none";
        this.elPhase2.style.display = "block";

        this.elGenieContainer.className = "genie-avatar-container revealed";
        this.setGenieSpeech(res.speech || "見えましたよ…！あなたの回答から、私が推測した可能性はこちらです！");

        this.elProbList.innerHTML = "";
        const rawDiseases = res.diseases || [];

        // 確率の合計が必ず100%になるように正規化
        const totalProb = rawDiseases.reduce((sum, d) => sum + (Math.max(1, Number(d.probability) || 0)), 0);
        let normalizedDiseases = [];
        if (totalProb > 0) {
            let currentSum = 0;
            normalizedDiseases = rawDiseases.map((d, idx) => {
                const rawP = Math.max(1, Number(d.probability) || 0);
                let p = Math.round((rawP / totalProb) * 100);
                if (idx === rawDiseases.length - 1) {
                    p = Math.max(1, 100 - currentSum); // 端数調整で合計100%に合わせる
                } else {
                    currentSum += p;
                }
                return { ...d, probability: p };
            });
        } else {
            normalizedDiseases = rawDiseases;
        }

        normalizedDiseases.forEach(d => {
            const card = document.createElement("div");
            card.className = "prob-card";
            card.innerHTML = `
                <div class="prob-header">
                    <span class="prob-title">● ${d.name}の可能性</span>
                    <span class="prob-percent">${d.probability}%</span>
                </div>
                <div class="prob-bar-bg">
                    <div class="prob-bar-fill" style="width: ${d.probability}%;"></div>
                </div>
                <div class="prob-reason">理由・特徴：${d.reason}</div>
            `;
            this.elProbList.appendChild(card);
        });

        this.elDeptContent.textContent = res.department || "一般内科";
        this.elOtcContent.textContent = res.otcDrug || "薬剤師にご相談ください";
        this.elFoodContent.textContent = res.food || "消化の良い温かい食事";
        this.elQuickCareContent.textContent = res.quickCare || "安静にして体を休める";
        this.elPreventionContent.textContent = res.prevention || "規則正しい生活習慣";

        this.elBtnBoost.textContent = "🔍 さらに精度を上げる（＋追加質問）";
        this.elBtnBoost.style.opacity = "1";
        this.elBtnBoost.style.cursor = "pointer";

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // 結果表示
    showResults() {
        this.currentPhase = 2;
        this.elPhase0.style.display = "none";
        this.elPhase1.style.display = "none";
        this.elPhase2.style.display = "block";

        // 結果発表時のひらめき・ズームイン演出
        this.elGenieContainer.className = "genie-avatar-container revealed";

        this.setGenieSpeech("見えましたよ…！あなたの回答から、私が推測した可能性はこちらです！");

        // 疾患スコア計算
        const scored = this.calculateCurrentTopDiseases();
        const topDiseases = scored.slice(0, 3);
        const totalProb = topDiseases.reduce((sum, d) => sum + (Math.max(1, d.score || 0)), 0);

        let currentSum = 0;
        const normalizedDiseases = topDiseases.map((d, idx) => {
            let p = Math.round(((Math.max(1, d.score || 0)) / totalProb) * 100);
            if (idx === topDiseases.length - 1) {
                p = Math.max(1, 100 - currentSum); // 端数調整で合計100%に合わせる
            } else {
                currentSum += p;
            }
            return { ...d, probability: p };
        });

        // 確率リストの描画
        this.elProbList.innerHTML = "";
        normalizedDiseases.forEach(d => {
            const card = document.createElement("div");
            card.className = "prob-card";
            card.innerHTML = `
                <div class="prob-header">
                    <span class="prob-title">● ${d.name}の可能性</span>
                    <span class="prob-percent">${d.probability}%</span>
                </div>
                <div class="prob-bar-bg">
                    <div class="prob-bar-fill" style="width: ${d.probability}%;"></div>
                </div>
                <div class="prob-reason">理由・特徴：${d.reason}</div>
            `;
            this.elProbList.appendChild(card);
        });

        // トップ疾患の情報を表示
        const topDisease = normalizedDiseases[0] || scored[0];
        this.elDeptContent.textContent = topDisease.department;
        this.elOtcContent.textContent = topDisease.otcDrug;
        this.elFoodContent.textContent = topDisease.food;
        this.elQuickCareContent.textContent = topDisease.quickCare;
        this.elPreventionContent.textContent = topDisease.prevention;

        this.elBtnBoost.textContent = "🔍 さらに精度を上げる（＋追加質問）";
        this.elBtnBoost.style.opacity = "1";
        this.elBtnBoost.style.cursor = "pointer";

        // スクロールを上部へ
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // 【追加機能】さらに精度を上げる（＋追加質問）
    boostQuestions() {
        if (this.isAiMode) {
            if (this.maxQuestions >= 8) {
                alert("これ以上の深掘り質問はありません！ここまでの全回答から導き出した最高精度の結果です。");
                return;
            }
            this.maxQuestions = 8;

            this.currentPhase = 1;
            this.elPhase0.style.display = "none";
            this.elPhase1.style.display = "block";
            this.elPhase2.style.display = "none";
            this.setGenieSpeech("ふむ…まだ私の推理に納得がいかないようですね。ならばもっと奥深くまで探らせていただきましょう…！");
            this.askGeminiNextQuestion("さらに質問を追加して、より深い観点から絞り込みを続けてください。");
            return;
        }

        if (this.maxQuestions >= 8 || !this.categoryData.extraQuestions || this.categoryData.extraQuestions.length === 0) {
            alert("これ以上の深掘り質問はありません！ここまでの全回答から導き出した最高精度の結果です。");
            return;
        }

        this.activeQuestions = [...this.categoryData.primaryQuestions, ...this.categoryData.extraQuestions];
        this.maxQuestions = Math.min(8, this.activeQuestions.length);

        this.elGenieContainer.className = "genie-avatar-container";
        this.currentPhase = 1;
        this.elPhase0.style.display = "none";
        this.elPhase1.style.display = "block";
        this.elPhase2.style.display = "none";

        this.setGenieSpeech("ふむ…まだ私の推理に納得がいかないようですね。ならばもっと奥深くまで探らせていただきましょう…！");
        this.renderAdaptiveQuestion();
    }

    resetApp() {
        this.elGenieContainer.className = "genie-avatar-container";
        this.currentPhase = 0;
        this.categoryKey = null;
        this.categoryData = null;
        this.activeQuestions = [];
        this.currentQuestionIdx = 0;
        this.minQuestions = 2;
        this.maxQuestions = 5;
        this.answers = {};
        this.conversationHistory = [];
        this.userNotes = [];
        this.isAiMode = !!this.geminiApiKey;
        this.updateAiModeBadge();

        this.elSymptomInput.value = "";
        this.elPhase0.style.display = "block";
        this.elPhase1.style.display = "none";
        this.elPhase2.style.display = "none";

        this.setGenieSpeech("こんにちは！私はあなたの体調不良の原因を推測するヘルス・アキネーターです。今、一番気になっている症状を1つ教えてください。");
    }

    setGenieSpeech(text) {
        this.elGenieSpeech.textContent = text;
    }
}

// 起動
document.addEventListener("DOMContentLoaded", () => {
    window.app = new HealthAkinatorApp();
});
