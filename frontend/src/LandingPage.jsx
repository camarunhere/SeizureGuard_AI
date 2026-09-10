import Background, { BG_TINT } from "./Background";

const FEATURES = [
  { icon: "🧠", title: "AI-Based Seizure Prediction", text: "A CNN + BiLSTM + Transformer deep learning model trained on real EEG recordings predicts seizure risk before it happens." },
  { icon: "⌚", title: "Real-Time Health Monitoring", text: "Continuous EEG and wearable biosensor monitoring — heart rate, SpO₂, movement, and temperature." },
  { icon: "💡", title: "Explainable AI (XAI)", text: "Every prediction comes with plain-English reasons and SHAP feature importance — never a black box." },
  { icon: "🚨", title: "Patient Safety Alerts", text: "High-risk predictions immediately notify linked clinicians so help arrives before a seizure, not after." },
  { icon: "🩺", title: "Clinical Dashboard", text: "Clinicians monitor multiple patients at once, review AI reports, and log clinical decisions." },
  { icon: "📡", title: "Wearable Integration", text: "Designed around EEG headsets and wearable biosensors feeding a multi-agent AI pipeline in real time." },
];

export default function LandingPage({ onGetStarted }) {
  return (
    <div className={`min-h-screen ${BG_TINT}`}>
      <Background />

      <header className="relative z-10 border-b border-white/40 bg-white/60 backdrop-blur-md sticky top-0">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-8">
          <div className="font-bold text-blue-950 text-lg flex items-center gap-2">🧠 SeizureGuard AI</div>
          <nav className="hidden sm:flex gap-6 text-sm font-medium text-slate-600">
            <a href="#home" className="hover:text-blue-900">Home</a>
            <a href="#about" className="hover:text-blue-900">About</a>
            <a href="#technology" className="hover:text-blue-900">AI Technology</a>
            <a href="#features" className="hover:text-blue-900">Features</a>
          </nav>
          <button
            onClick={onGetStarted}
            className="ml-auto px-4 py-2 rounded-xl text-sm font-semibold bg-blue-950 hover:bg-blue-900 text-white transition"
          >
            Login
          </button>
        </div>
      </header>

      <main className="relative z-10">
        <section id="home" className="max-w-4xl mx-auto px-4 pt-20 pb-16 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight leading-tight">
            AI-Powered Early Seizure Prediction<br />and Clinical Decision Support
          </h1>
          <p className="text-lg text-slate-300 mt-5 max-w-2xl mx-auto">
            Combining wearable sensors, deep learning, and Explainable AI to improve epilepsy management —
            for patients and clinicians.
          </p>
          <div className="flex items-center justify-center gap-4 mt-8">
            <button onClick={onGetStarted} className="px-6 py-3 rounded-xl text-base font-semibold bg-blue-950 hover:bg-blue-900 text-white shadow-lg shadow-blue-950/20 transition">
              Get Started
            </button>
            <button onClick={onGetStarted} className="px-6 py-3 rounded-xl text-base font-semibold bg-white/80 hover:bg-white border border-slate-200 text-slate-700 transition">
              Login
            </button>
          </div>
        </section>

        <section id="about" className="max-w-5xl mx-auto px-4 py-10">
          <div className="bg-white/75 backdrop-blur-md border border-white/60 rounded-2xl shadow-lg p-8 text-center">
            <p className="text-slate-600 max-w-3xl mx-auto">
              SeizureGuard AI is a clinical decision support platform designed to predict epileptic seizures
              early using multimodal patient data collected from EEG and wearable biosensors — combining
              AI agents, deep learning, and Explainable AI to provide real-time monitoring, seizure risk
              prediction, and understandable explanations for patients and clinicians.
            </p>
          </div>
        </section>

        <section id="features" className="max-w-5xl mx-auto px-4 py-10">
          <h2 className="text-center text-2xl font-bold text-white mb-8">What the Platform Does</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-white/75 backdrop-blur-md border border-white/60 rounded-2xl shadow-md p-6 hover:shadow-lg transition">
                <div className="text-3xl mb-3">{f.icon}</div>
                <h3 className="font-semibold text-slate-800 mb-1.5">{f.title}</h3>
                <p className="text-sm text-slate-600">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="technology" className="max-w-3xl mx-auto px-4 py-10 pb-20 text-center">
          <div className="bg-blue-950 text-white rounded-2xl shadow-xl p-8">
            <h2 className="text-xl font-bold mb-2">Multi-Agent AI Architecture</h2>
            <p className="text-blue-100 text-sm">
              Data Collection → Preprocessing → Feature Extraction → CNN + BiLSTM + Transformer →
              Explainability Agent → Decision Support Agent → Alert System
            </p>
          </div>
        </section>
      </main>

      <footer className="relative z-10 text-center text-xs text-slate-400 pb-8">
        SeizureGuard AI is a research prototype and does not replace professional medical care.
      </footer>
    </div>
  );
}
