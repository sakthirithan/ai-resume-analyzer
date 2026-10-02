import Navbar from "~/components/Navbar";
import type { Route } from "./+types/home";
import ResumeCard from "~/components/ResumeCard";
import { usePuterStore } from "~/lib/puter";
import { useNavigate, Link } from "react-router";
import { useEffect, useState } from "react";
import resumeScan from "../../images/resume-scan-2.gif?url";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Resumind" },
    { name: "description", content: "Smart feedback for your dream job!" },
  ];
}

export default function Home() {
  const { auth, isLoading, kv, puterReady } = usePuterStore();
  const navigate = useNavigate();
  const [ resumes, setResumes ] = useState<Resume[]>([]);
  const [ loadingResumes, setLoadingResumes ] = useState(true);
  const [ loadError, setLoadError ] = useState("");

  useEffect(() => {
    if (!isLoading && !auth.isAuthenticated) navigate("/auth?next=/");
  }, [auth.isAuthenticated, isLoading, navigate]);

  useEffect(() => {
    if (!puterReady || isLoading || !auth.isAuthenticated) return;

    let isCurrent = true;
    const loadResumes = async () => {
      setLoadingResumes(true);
      setLoadError("");

      try {
        const storedResumes = (await kv.list("resume:*", true)) as KVItem[] | undefined;
        const parsedResumes = storedResumes?.map((resume) =>
          JSON.parse(resume.value) as Resume
        ) ?? [];

        if (isCurrent) setResumes(parsedResumes);
      } catch (error) {
        if (isCurrent) {
          setLoadError(error instanceof Error ? error.message : "Failed to load resumes.");
        }
      } finally {
        if (isCurrent) setLoadingResumes(false);
      }
    }

    loadResumes();
    return () => {
      isCurrent = false;
    };
  }, [auth.isAuthenticated, isLoading, kv, puterReady]);

  return (
    <main className="bg-[url('/bg-main.svg')] bg-cover min-h-screen">
      <Navbar />
      <section className="main-section">
        <div className="page-heading py-16">
          <h1>Track Your Application & Resume Ratings</h1>
          {loadingResumes ? (
            <h2>Loading your resumes...</h2>
          ) : loadError ? (
            <h2>We couldn't load your resumes.</h2>
          ) : resumes.length === 0 ? (
            <h2>No resumes found. Upload your first resume to get feedback.</h2>
          ) : (
            <h2>Review your submissions and check AI-powered feedback</h2>
          )}
        </div>
        {loadingResumes && (
          <div className="flex flex-col items-center justify-center">
            <img src={resumeScan} alt="Loading resumes" className="w-50" />
          </div>
        )}

        {!loadingResumes && resumes.length > 0 && (
          <div className="resumes-section">
            {resumes.map((resume) => (
              <ResumeCard key={resume.id} resume={resume} />
            ))}
          </div>
        )}

        {!loadingResumes && !loadError && resumes.length === 0 && (
          <div className="flex flex-col items-center justify-center mt-10 gap-4">
            <Link to="/upload" className="primary-button w-fit text-xl font-semibold">
              Upload Resume
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
