import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import Navbar from '~/components/Navbar';
import FileUploader from '~/components/FileUploader';
import { usePuterStore, parseAndValidateAIResponse } from '~/lib/puter';
import { convertPdfToImage } from '~/lib/pdf2img';
import { extractResumeText } from '~/lib/resumeParser';
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
    const [ file, setFile ] = useState<File | null>(null);

    const handleFileSelect = (selectedFile: File | null) => {
        setFile(selectedFile);
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
        setStatusText('Uploading resume file...');
        let currentStage = 'uploading resume';

        try {
            const uploadedFile = await fs.upload([file]);

            if (!uploadedFile) {
                setStatusText('Error: Puter did not return an uploaded file. Please sign in and try again.');
                setIsProcessing(false);
                return;
            }

            currentStage = 'converting the PDF preview';
            setStatusText('Rendering preview image...');

            const imageFile = await convertPdfToImage(file);
            let uploadedImagePath = '/images/resume_01.png';

            if (imageFile.file) {
                currentStage = 'uploading preview image';
                setStatusText('Uploading preview image...');
                const uploadedImage = await fs.upload([imageFile.file]);
                if (uploadedImage) {
                    uploadedImagePath = uploadedImage.path;
                }
            }

            currentStage = 'extracting text from resume';
            setStatusText('Extracting resume text content...');

            const extractionResult = await extractResumeText(file, {
                imageFile: imageFile.file,
                ocrService: async (imgBlob) => {
                    const ocrRes = await ai.img2txt(imgBlob);
                    return ocrRes;
                }
            });

            const uuid = generateUUID();

            if (!extractionResult.success || !extractionResult.extractedText) {
                console.warn(`[Resume Analysis] Text extraction failed: ${extractionResult.error}`);
                const errorData = {
                    id: uuid,
                    resumePath: uploadedFile.path,
                    imagePath: uploadedImagePath,
                    companyName,
                    jobTitle,
                    jobDescription,
                    status: 'PARSING_FAILED',
                    error: {
                        code: extractionResult.errorCode || 'TEXT_EXTRACTION_FAILED',
                        message: extractionResult.error || 'Failed to extract readable text from the resume.'
                    },
                    createdAt: new Date().toISOString()
                };

                await kv.set(`resume:${uuid}`, JSON.stringify(errorData));
                setStatusText(`Error: ${extractionResult.error || 'Failed to extract readable text from resume.'}`);
                setIsProcessing(false);
                return;
            }

            currentStage = 'analyzing resume with AI';
            setStatusText('Analyzing candidate resume against job requirements...');

            const prompt = prepareInstructions({
                jobTitle,
                jobDescription,
                resumeText: extractionResult.extractedText,
            });

            const aiResponse = await ai.analyzeResumeText(prompt);

            if (!aiResponse || !aiResponse.message) {
                const errorData = {
                    id: uuid,
                    resumePath: uploadedFile.path,
                    imagePath: uploadedImagePath,
                    companyName,
                    jobTitle,
                    jobDescription,
                    status: 'ANALYSIS_FAILED',
                    error: {
                        code: 'AI_RESPONSE_EMPTY',
                        message: 'AI service returned an empty response.'
                    },
                    createdAt: new Date().toISOString()
                };

                await kv.set(`resume:${uuid}`, JSON.stringify(errorData));
                setStatusText('Error: AI service failed to return feedback. Please try again.');
                setIsProcessing(false);
                return;
            }

            const rawContent = typeof aiResponse.message.content === 'string'
                ? aiResponse.message.content
                : Array.isArray(aiResponse.message.content)
                    ? aiResponse.message.content.map((c: any) => (typeof c === 'string' ? c : c.text || '')).join('\n')
                    : JSON.stringify(aiResponse.message.content);

            let feedback;
            try {
                feedback = parseAndValidateAIResponse(rawContent);
            } catch (jsonErr) {
                console.error('[Resume Analysis] Failed to parse AI JSON:', jsonErr, rawContent);
                setStatusText('Error: AI returned invalid response format.');
                setIsProcessing(false);
                return;
            }

            const data = {
                id: uuid,
                status: 'COMPLETED',
                resumePath: uploadedFile.path,
                imagePath: uploadedImagePath,
                companyName,
                jobTitle,
                jobDescription,
                feedback,
                meta: {
                    characterCount: extractionResult.characterCount,
                    method: extractionResult.method,
                    pageCount: extractionResult.pageCount
                },
                createdAt: new Date().toISOString()
            };

            await kv.set(`resume:${uuid}`, JSON.stringify(data));

            setStatusText('Analysis complete! Redirecting...');
            setTimeout(() => {
                console.log(data);
                navigate(`/resume/${uuid}`);
            }, 600);
        } catch (error) {
            setStatusText(`Error ${currentStage}: ${describeUploadError(error)}`);
            setIsProcessing(false);
        }
    };

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const form = e.currentTarget.closest('form');
        if (!form) return;

        const formData = new FormData(form);

        const companyName = (formData.get('company-name') as string) || '';
        const jobTitle = (formData.get('job-title') as string) || '';
        const jobDescription = (formData.get('job-description') as string) || '';

        if (!file) {
            setStatusText('Please select a resume file before analyzing.');
            return;
        }

        handleAnalyze({
            companyName, 
            jobTitle,
            jobDescription,
            file
        });
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
                {!isProcessing && statusText && <p role="alert" className="text-red-600 font-medium mt-2">{statusText}</p>}
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
                            <label htmlFor="uploader" className="">Upload resume</label>
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
  );
};

export default Upload;