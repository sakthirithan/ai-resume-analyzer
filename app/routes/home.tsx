import Navbar from "~/components/Navbar";
import type { Route } from "./+types/home";
import { resumes as mockResumes } from "../../constants";
import ResumeCard from "~/components/ResumeCard";
import { usePuterStore } from "~/lib/puter";
import { useNavigate } from "react-router";
import { useEffect, useState } from "react";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Resumind" },
    { name: "description", content: "Smart feedback for your dream job!" },
  ];
}

export default function Home() {
  const { auth, kv, puterReady } = usePuterStore();
  const navigate = useNavigate();
  const [ userResumes, setUserResumes ] = useState<Resume[]>([]);
  const [ loadingKv, setLoadingKv ] = useState(true);

  useEffect(() => {
    if (!auth.isAuthenticated) navigate("/auth?next=/");
  }, [auth.isAuthenticated, navigate]);

  useEffect(() => {
    async function loadUserResumes() {
      if (!puterReady) return;
      try {
        const keys = await kv.list("resume:*", false);
        if (Array.isArray(keys) && keys.length > 0) {
          const loaded: Resume[] = [];
          for (const key of keys) {
            const rawKey = typeof key === "string" ? key : (key as any).key;
            if (!rawKey) continue;
            const val = await kv.get(rawKey);
            if (val) {
              try {
                const parsed = JSON.parse(val);
                // Map stored object to Resume structure if completed or valid feedback
                const overallScore = parsed.feedback?.overallScore ?? (parsed.status === "PARSING_FAILED" ? 0 : 70);
                loaded.push({
                  id: parsed.id,
                  companyName: parsed.companyName || "Untitled Company",
                  jobTitle: parsed.jobTitle || "Resume Submission",
                  imagePath: parsed.imagePath || "/images/resume_01.png",
                  resumePath: parsed.resumePath || "",
                  feedback: parsed.feedback || {
                    overallScore,
                    ATS: { score: 0, tips: [] },
                    toneAndStyle: { score: 0, tips: [] },
                    content: { score: 0, tips: [] },
                    structure: { score: 0, tips: [] },
                    skills: { score: 0, tips: [] },
                  },
                });
              } catch (e) {
                console.warn("Failed to parse resume item:", e);
              }
            }
          }
          if (loaded.length > 0) {
            setUserResumes(loaded.reverse()); // Show newest first
          }
        }
      } catch (err) {
        console.warn("Could not list user resumes from Puter KV:", err);
      } finally {
        setLoadingKv(false);
      }
    }

    loadUserResumes();
  }, [puterReady, kv]);

  const allResumes = userResumes.length > 0 ? [...userResumes, ...mockResumes] : mockResumes;

  return (
    <main className="bg-[url('/bg-main.svg')] bg-cover min-h-screen">
      <Navbar />
      <section className="main-section">
        <div className="page-heading py-16">
          <h1>Track Your Application & Resume Ratings</h1>
          <h2>Review your submission and check AI-powered feedback</h2>
        </div>

        {allResumes.length > 0 && (
          <div className="resumes-section">
            {allResumes.map((resume) => (
              <ResumeCard key={resume.id} resume={resume} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
