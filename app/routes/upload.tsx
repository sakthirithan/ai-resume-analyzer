import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import Navbar from '~/components/Navbar';
import FileUploader from '~/components/FileUploader';
import { usePuterStore } from '~/lib/puter';
import { convertPdfToImage } from '~/lib/pdf2img';
import { generateUUID } from '~/lib/utils';
import { prepareInstructions } from '../../constants/index';

const describeUploadError = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (!error || typeof error !== 'object') return 'Unknown error';

    const details = error as {
        message?: unknown;
        code?: unknown;
        status?: unknown;
        failedItems?: unknown;
    };
    const parts = [details.message, details.code, details.status]
        .filter((part) => part !== undefined && part !== null && part !== '')
        .map(String);

    if (Array.isArray(details.failedItems)) {
        const failedItems = details.failedItems
            .map((item) => {
                if (!item || typeof item !== 'object') return String(item);
                const failedItem = item as { path?: unknown; message?: unknown; code?: unknown };
                return [failedItem.path, failedItem.message, failedItem.code]
                    .filter((part) => part !== undefined && part !== null && part !== '')
                    .map(String)
                    .join(': ');
            })
            .filter(Boolean);
        parts.push(...failedItems);
    }

    return parts.length > 0 ? parts.join(' - ') : JSON.stringify(error);
};

const Upload = () => {
    const { auth, isLoading, puterReady, fs, ai, kv } = usePuterStore();
    const navigate = useNavigate();
    const [ isProcessing, setIsProcessing ] = useState(false);
    const [ statusText, setStatusText ] = useState('');
    const [file, setFile] = useState<File | null>(null);

    const handleFileSelect = (file: File | null) => {
        setFile(file);
    };

    const handleAnalyze = async ({ companyName, jobTitle, jobDescription, file }: { companyName: string, jobTitle: string, jobDescription: string, file: File}) => {
        if (!puterReady || isLoading) {
            setStatusText('Puter is still initializing. Please try again shortly.');
            return;
        }

        if (!auth.isAuthenticated) {
            navigate('/auth?next=/upload');
            return;
        }

        setIsProcessing(true);
        setStatusText('Uploading resume...');
        let currentStage = 'uploading resume';

        try {
            const uploadedFile = await fs.upload([file]);

            if (!uploadedFile) {
                setStatusText('Error: Puter did not return an uploaded file. Please sign in and try again.');
                setIsProcessing(false);
                return;
            }

            currentStage = 'converting the PDF';
            setStatusText('Converting to image...');

            const imageFile = await convertPdfToImage(file);
            if (!imageFile.file) {
                setStatusText(imageFile.error ?? 'Error: Failed to convert PDF to image.');
                setIsProcessing(false);
                return;
            }

            currentStage = 'uploading the preview image';
            setStatusText('Uploading the image...');
            const uploadedImage = await fs.upload([imageFile.file]);
            if (!uploadedImage) {
                setStatusText('Error: Puter did not return the uploaded image. Please try again.');
                setIsProcessing(false);
                return;
            }

            currentStage = 'saving resume data';
            setStatusText('Preparing data...');

            const uuid = generateUUID();

            const data = {
                id: uuid,
                resumePath: uploadedFile.path,
                imagePath: uploadedImage.path,
                companyName,
                jobTitle,
                jobDescription,
                feedback: '',
            };

            await kv.set(`resume:${uuid}`, JSON.stringify(data));

            currentStage = 'analyzing the resume';
            setStatusText('Analyzing...');

            const feedback = await ai.feedback(
                uploadedFile.path,
                prepareInstructions({
                    jobTitle,
                    jobDescription,
                }),
            );
            if (!feedback) {
                setStatusText('Error: Failed to analyze resume. Please try again.');
                setIsProcessing(false);
                return;
            }

            const feedbackText = typeof feedback.message.content === 'string'
                ? feedback.message.content
                : feedback.message.content[0].text;

            data.feedback = JSON.parse(feedbackText);
            await kv.set(`resume:${uuid}`, JSON.stringify(data));

            setStatusText('Analysis complete, redirecting...');
            console.log(data);
        } catch (error) {
            setStatusText(`Error ${currentStage}: ${describeUploadError(error)}`);
            setIsProcessing(false);
        }
    };

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const form = e.currentTarget.closest('form');
        if(!form) return;

        const formData = new FormData(form);

        const companyName = formData.get('company-name') as string;
        const jobTitle = formData.get('job-title') as string;
        const jobDescription = formData.get('job-description') as string;

        if(!file) return;

        handleAnalyze({
            companyName, 
            jobTitle,
            jobDescription,
            file
        })

    };

  return (
    <main className="bg-[url('/bg-main.svg')] bg-cover">
        <Navbar />
        <section className="main-section">
            <div className="page-heading py-2">
                <h1>Smart feedback for your dream job!</h1>
                {isProcessing ? (
                    <>
                        <h2>{statusText}</h2>
                        <img src="./images/resume-scan.gif" alt="resume-scan"  
                        className='w-full'
                        />
                    </>
                ) : (
                    <h2>Drop your resume for an ATS score and improvement tips</h2>
                )}
                {!isProcessing && statusText && <p role="alert">{statusText}</p>}
                {!isProcessing && (
                    <form id="upload-form" onSubmit={handleSubmit} className="flex flex-col gap-4 mt-8">
                        <div className="form-div">
                            <label htmlFor="company-name" className="">Company Name</label>
                            <input type="text" id="company-name" name="company-name" placeholder="Company Name" />
                        </div>
                        <div className="form-div">
                            <label htmlFor="job-title" className="">Job Title</label>
                            <input type="text" id="job-title" name="job-title" placeholder="Job Title" />
                        </div>
                        <div className="form-div">
                            <label htmlFor="job-description" className="">Job Description</label>
                            <textarea rows={5} id="job-description" name="job-description" placeholder="Job Description" />
                        </div>
                        <div className="form-div">
                            <label htmlFor="uplaoder" className="">Upload resume</label>
                            <FileUploader onFileSelect={handleFileSelect} />
                        </div>

                        <button className="primary-button" type='submit'>
                            Analyze Resume
                        </button>
                    </form>
                )}
            </div>
        </section>
    </main>
  )
}

export default Upload