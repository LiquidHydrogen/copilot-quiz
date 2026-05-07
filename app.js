const { createApp, ref, computed, watch, onMounted } = Vue;

// Domain keywords for auto-categorization
const DOMAIN_KEYWORDS = {
  'Code Completions': ['code suggestion', 'inline suggestion', 'code completion', 'fill-in-the-middle', 'FIM'],
  'Copilot Chat': ['Copilot Chat', 'chat history', 'slash command', '/fix', '/tests', '/explain', '/optimize'],
  'Privacy & Data': ['privacy', 'data retention', 'prompt data', 'data collection', 'content exclusion', 'exclude'],
  'Security': ['security', 'vulnerability', 'IP infringement', 'public code', 'duplication detection', 'toxicity'],
  'Plans & Pricing': ['plan', 'pricing', 'Business', 'Enterprise', 'Individual', 'subscription', 'billing', 'seat'],
  'API & Metrics': ['API', 'metrics', 'audit log', 'REST API', 'endpoint'],
  'Prompt Engineering': ['prompt', 'zero-shot', 'few-shot', 'role prompting', 'context'],
  'AI Ethics': ['fairness', 'bias', 'transparency', 'responsible', 'ethical', 'inclusiveness'],
  'Testing': ['test', 'unit test', '/tests'],
  'IDE & Tools': ['IDE', 'CLI', 'Neovim', 'Visual Studio', 'extension', 'plug-in', 'GitHub Mobile'],
  'Knowledge Base': ['knowledge base', 'Knowledge Base', '@workspace'],
};

function categorizeQuestion(q) {
  const text = (q.stem + ' ' + Object.values(q.options).join(' ')).toLowerCase();
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) return domain;
    }
  }
  return 'Other';
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const STORAGE_KEY = 'copilot-quiz-data';

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

createApp({
  setup() {
    // State
    const allQuestions = ref([]);
    const currentView = ref('home');
    const viewHistory = ref([]);
    const currentQuestions = ref([]);
    const currentIndex = ref(0);
    const selectedOptions = ref([]);
    const showAnswer = ref(false);
    const isCorrect = ref(false);
    const wrongBook = ref([]);
    const studiedSet = ref(new Set());
    const examCorrect = ref(0);
    const examWrong = ref(0);
    const examAnswers = ref([]);
    const timerActive = ref(false);
    const timeLeft = ref(0);
    let timerInterval = null;
    const showTranslation = ref(false);

    const settings = ref({
      examCount: 60,
      examTime: 45,
      autoNext: false,
    });

    // Load persisted data
    const saved = loadData();
    if (saved) {
      wrongBook.value = saved.wrongBook || [];
      studiedSet.value = new Set(saved.studiedSet || []);
      if (saved.settings) Object.assign(settings.value, saved.settings);
    }

    // Auto-save on changes
    watch([wrongBook, studiedSet, settings], () => {
      saveData({
        wrongBook: wrongBook.value,
        studiedSet: [...studiedSet.value],
        settings: settings.value,
      });
    }, { deep: true });

    // Load questions
    onMounted(() => {
      if (window.QUESTIONS_DATA) {
        allQuestions.value = window.QUESTIONS_DATA.map(q => ({ ...q, domain: categorizeQuestion(q) }));
      }
    });

    // Computed
    const totalQuestions = computed(() => allQuestions.value.length);
    const studiedCount = computed(() => studiedSet.value.size);
    const overallProgress = computed(() => totalQuestions.value ? Math.round(studiedCount.value / totalQuestions.value * 100) : 0);
    const wrongCount = computed(() => wrongBook.value.length);

    const domains = computed(() => {
      const map = {};
      allQuestions.value.forEach(q => {
        if (!map[q.domain]) map[q.domain] = { name: q.domain, count: 0 };
        map[q.domain].count++;
      });
      return Object.values(map).sort((a, b) => b.count - a.count);
    });

    const currentQuestion = computed(() => currentQuestions.value[currentIndex.value] || {});
    // Compute shuffle mapping once: shuffledKeys[i] = original key now at position i
    const shuffledKeyMap = computed(() => {
      const q = currentQuestion.value;
      if (!q.options) return null;
      const keys = Object.keys(q.options);
      const seed = q.id ? q.id.replace(/\D/g, '') : '0';
      let hash = parseInt(seed) || 0;
      const shuffledKeys = [...keys];
      for (let i = shuffledKeys.length - 1; i > 0; i--) {
        hash = (hash * 31 + currentIndex.value * 17 + i * 7) & 0x7FFFFFFF;
        const j = hash % (i + 1);
        [shuffledKeys[i], shuffledKeys[j]] = [shuffledKeys[j], shuffledKeys[i]];
      }
      return { keys, shuffledKeys };
    });

    // Shuffle option CONTENT behind A/B/C/D labels, keeping labels in order
    const shuffledOptions = computed(() => {
      const map = shuffledKeyMap.value;
      if (!map) return {};
      const { keys, shuffledKeys } = map;
      const result = {};
      keys.forEach((label, i) => {
        result[label] = currentQuestion.value.options[shuffledKeys[i]];
      });
      return result;
    });

    // Map original answer keys to shuffled positions
    const shuffledAnswer = computed(() => {
      const map = shuffledKeyMap.value;
      if (!map || !currentQuestion.value.answer) return '';
      const { keys, shuffledKeys } = map;
      const originalAnswers = currentQuestion.value.answer.split(',').map(s => s.trim());
      const mapped = originalAnswers.map(orig => {
        const idx = shuffledKeys.indexOf(orig);
        return keys[idx];
      });
      return mapped.join(',');
    });
    const isLastQuestion = computed(() => currentIndex.value >= currentQuestions.value.length - 1);
    const questionProgress = computed(() => currentQuestions.value.length ? Math.round((currentIndex.value + 1) / currentQuestions.value.length * 100) : 0);
    const examTotal = computed(() => currentQuestions.value.length);
    const examScore = computed(() => examTotal.value ? Math.round(examCorrect.value / examTotal.value * 100) : 0);
    const scoreClass = computed(() => examScore.value >= 70 ? 'pass' : 'fail');
    const examWrongList = computed(() => examAnswers.value.filter(a => !a.correct));

    const viewTitle = computed(() => {
      const titles = {
        'home': 'Copilot 认证刷题',
        'practice-domains': '选择领域',
        'practice': '练习模式',
        'exam': '考试模式',
        'mock': '模拟考试',
        'mock-select': '模拟考试',
        'wrong-book': '错题本',
        'result': '考试结果',
        'settings': '设置',
        'notes': '笔记模式',
      };
      return titles[currentView.value] || 'Copilot 认证刷题';
    });

    // Navigation
    function navigate(view) {
      viewHistory.value.push(currentView.value);
      currentView.value = view;
    }

    function goBack() {
      // If in exam/mock mode, warn before exiting
      if (currentView.value === 'exam' || currentView.value === 'mock') {
        if (!confirm('正在考试中，确定退出？退出后本次考试成绩将不计入。')) return;
        // Discard exam data and remove wrong answers added during this exam
        const examWrongIds = examAnswers.value.filter(a => !a.correct).map(a => a.question.id);
        wrongBook.value = wrongBook.value.filter(q => !examWrongIds.includes(q.id));
        examAnswers.value = [];
        examCorrect.value = 0;
        examWrong.value = 0;
      }
      const prev = viewHistory.value.pop();
      currentView.value = prev || 'home';
      stopTimer();
    }

    function goHome() {
      examAnswers.value = [];
      examCorrect.value = 0;
      examWrong.value = 0;
      currentView.value = 'home';
      viewHistory.value = [];
      stopTimer();
    }

    // Domain progress
    function getDomainProgress(domainName) {
      const domainQs = allQuestions.value.filter(q => q.domain === domainName);
      if (!domainQs.length) return 0;
      const studied = domainQs.filter(q => studiedSet.value.has(q.id)).length;
      return Math.round(studied / domainQs.length * 100);
    }

    // Practice
    function enterPractice() { navigate('practice-domains'); }
    function startDomainPractice(domainName) {
      currentQuestions.value = allQuestions.value.filter(q => q.domain === domainName);
      currentIndex.value = 0;
      selectedOptions.value = [];
      showAnswer.value = false;
      navigate('practice');
    }

    // Exam
    function enterExam() {
      const count = settings.value.examCount;
      currentQuestions.value = shuffleArray(allQuestions.value).slice(0, count);
      currentIndex.value = 0;
      selectedOptions.value = [];
      showAnswer.value = false;
      examCorrect.value = 0;
      examWrong.value = 0;
      examAnswers.value = [];
      navigate('exam');
      startTimer(settings.value.examTime * 60);
    }

    // Wrong Book
    function enterWrongBook() { navigate('wrong-book'); }
    function isInWrongBook(id) { return wrongBook.value.some(q => q.id === id); }
    function addToWrongBook(q) {
      if (!isInWrongBook(q.id)) wrongBook.value.push({ ...q });
    }
    function removeFromWrongBook(id) {
      wrongBook.value = wrongBook.value.filter(q => q.id !== id);
    }
    function clearWrongBook() {
      if (confirm('确定清空错题本？')) wrongBook.value = [];
    }
    function startWrongPractice() {
      if (!wrongBook.value.length) return;
      currentQuestions.value = [...wrongBook.value];
      currentIndex.value = 0;
      selectedOptions.value = [];
      showAnswer.value = false;
      navigate('practice');
    }
    function startWrongRandom() {
      if (!wrongBook.value.length) return;
      currentQuestions.value = shuffleArray(wrongBook.value);
      currentIndex.value = 0;
      selectedOptions.value = [];
      showAnswer.value = false;
      navigate('practice');
    }
    function reviewWrong(q) {
      currentQuestions.value = [q];
      currentIndex.value = 0;
      selectedOptions.value = [];
      showAnswer.value = false;
      navigate('practice');
    }

    // Mock
    function enterMock() { navigate('mock-select'); }
    function startMockExam() {
      const count = settings.value.examCount;
      currentQuestions.value = shuffleArray(allQuestions.value).slice(0, count);
      currentIndex.value = 0;
      selectedOptions.value = [];
      showAnswer.value = false;
      examCorrect.value = 0;
      examWrong.value = 0;
      examAnswers.value = [];
      navigate('mock');
      startTimer(settings.value.examTime * 60);
    }
    function startMockSequential() {
      currentQuestions.value = [...allQuestions.value];
      currentIndex.value = 0;
      selectedOptions.value = [];
      showAnswer.value = false;
      examCorrect.value = 0;
      examWrong.value = 0;
      examAnswers.value = [];
      navigate('mock');
    }
    function startMockWrong() {
      if (!wrongBook.value.length) { alert('错题本为空'); return; }
      currentQuestions.value = shuffleArray(wrongBook.value);
      currentIndex.value = 0;
      selectedOptions.value = [];
      showAnswer.value = false;
      examCorrect.value = 0;
      examWrong.value = 0;
      examAnswers.value = [];
      navigate('mock');
    }
    function startMockNotes() {
      currentQuestions.value = [...allQuestions.value];
      navigate('notes');
    }

    // Settings
    function enterSettings() { navigate('settings'); }
    function resetProgress() {
      if (confirm('确定重置所有学习进度？此操作不可撤销。')) {
        studiedSet.value = new Set();
        wrongBook.value = [];
      }
    }

    // Answer logic
    function isMultiSelect(q) {
      return q.answer && q.answer.includes(',');
    }

    function getShuffledOptionZh(key) {
      const q = currentQuestion.value;
      const map = shuffledKeyMap.value;
      if (!q.options_zh || !map) return null;
      const { keys, shuffledKeys } = map;
      const idx = keys.indexOf(key);
      const origKey = shuffledKeys[idx];
      return q.options_zh[origKey] || null;
    }

    function selectOption(key) {
      if (showAnswer.value) return;
      if (isMultiSelect(currentQuestion.value)) {
        const idx = selectedOptions.value.indexOf(key);
        if (idx >= 0) selectedOptions.value.splice(idx, 1);
        else selectedOptions.value.push(key);
      } else {
        selectedOptions.value = [key];
      }
    }

    function optionClass(key) {
      if (!showAnswer.value) {
        return selectedOptions.value.includes(key) ? 'selected' : '';
      }
      const correctAnswers = shuffledAnswer.value.split(',').map(s => s.trim());
      const isSelected = selectedOptions.value.includes(key);
      const isCorrectOption = correctAnswers.includes(key);
      if (isCorrectOption) return 'correct';
      if (isSelected && !isCorrectOption) return 'wrong';
      return '';
    }

    function submitAnswer() {
      const correctAnswers = shuffledAnswer.value.split(',').map(s => s.trim());
      const selected = [...selectedOptions.value].sort();
      const correct = correctAnswers.sort();
      const correctResult = selected.length === correct.length && selected.every((v, i) => v === correct[i]);

      if (currentView.value === 'exam' || currentView.value === 'mock') {
        // Exam mode: record answer and move to next, no feedback
        examAnswers.value.push({
          question: { ...currentQuestion.value },
          selected: [...selectedOptions.value],
          correct: correctResult,
          shuffledAnswer: shuffledAnswer.value,
          shuffledOptions: { ...shuffledOptions.value },
        });
        if (correctResult) examCorrect.value++;
        else {
          examWrong.value++;
          addToWrongBook(currentQuestion.value);
        }
        // Auto advance
        if (isLastQuestion.value) {
          stopTimer();
          navigate('result');
        } else {
          currentIndex.value++;
          selectedOptions.value = [];
        }
      } else {
        // Practice mode: show analysis
        showAnswer.value = true;
        isCorrect.value = correctResult;
        studiedSet.value.add(currentQuestion.value.id);
        if (correctResult && settings.value.autoNext) {
          setTimeout(() => nextQuestion(), 800);
        }
      }
    }

    function nextQuestion() {
      if (isLastQuestion.value) {
        goBack();
        return;
      }
      currentIndex.value++;
      selectedOptions.value = [];
      showAnswer.value = false;
      isCorrect.value = false;
    }

    // Timer
    function startTimer(seconds) {
      timeLeft.value = seconds;
      timerActive.value = true;
      clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        timeLeft.value--;
        if (timeLeft.value <= 0) {
          stopTimer();
          // Time's up - go to result
          navigate('result');
        }
      }, 1000);
    }

    function stopTimer() {
      clearInterval(timerInterval);
      timerActive.value = false;
    }

    function formatTime(s) {
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return `${m}:${sec.toString().padStart(2, '0')}`;
    }

    return {
      currentView, currentQuestions, currentIndex, selectedOptions, showAnswer, isCorrect,
      wrongBook, settings, allQuestions, timerActive, timeLeft, showTranslation,
      examCorrect, examWrong, examTotal, examScore, scoreClass, examAnswers, examWrongList,
      totalQuestions, studiedCount, overallProgress, wrongCount,
      domains, currentQuestion, shuffledOptions, shuffledAnswer, isLastQuestion, questionProgress, viewTitle,
      navigate, goBack, goHome,
      getDomainProgress, enterPractice, startDomainPractice,
      enterExam, enterWrongBook, enterMock, enterSettings,
      isInWrongBook, addToWrongBook, removeFromWrongBook, clearWrongBook,
      startWrongPractice, startWrongRandom, reviewWrong,
      startMockExam, startMockSequential, startMockWrong, startMockNotes,
      resetProgress,
      isMultiSelect, selectOption, optionClass, submitAnswer, nextQuestion,
      formatTime, getShuffledOptionZh,
    };
  }
}).mount('#app');
