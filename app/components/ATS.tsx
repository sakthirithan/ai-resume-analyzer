import atsBadIcon from "../../icons/ats-bad.svg?url";
import atsWarningIcon from "../../icons/ats-warning.svg?url";
import checkIcon from "../../icons/check.svg?url";

interface ATSProps {
	score: number;
	suggestions: {
		type: "good" | "improve";
		tip: string;
	}[];
}

const ATS = ({ score, suggestions }: ATSProps) => {
	const status = score > 69
		? {
				gradient: "from-green-100",
				icon: checkIcon,
				title: "Strong ATS compatibility",
				description: "Your resume is well positioned to pass applicant tracking systems.",
			}
		: score > 49
			? {
					gradient: "from-yellow-100",
					icon: atsWarningIcon,
					title: "Good start, with room to improve",
					description: "A few focused changes could help your resume perform better in ATS scans.",
				}
			: {
					gradient: "from-red-100",
					icon: atsBadIcon,
					title: "Your resume needs attention",
					description: "Some important changes can improve how applicant tracking systems read your resume.",
				};

	return (
		<section className={`w-full rounded-2xl bg-linear-to-br ${status.gradient} to-white p-6 shadow-md`}>
			<div className="flex items-center gap-4">
				<img src={status.icon} alt="" className="size-10 shrink-0" />
				<h2 className="text-2xl font-bold text-gray-900">
					ATS Score - {score}/100
				</h2>
			</div>

			<div className="mt-5">
				<h3 className="text-lg font-semibold text-gray-900">{status.title}</h3>
				<p className="mt-1 text-gray-600">{status.description}</p>
			</div>

			<ul className="mt-5 flex flex-col gap-3">
				{suggestions.map((suggestion, index) => (
					<li key={`${suggestion.type}-${index}`} className="flex items-start gap-3 text-gray-800">
						<img
							src={suggestion.type === "good" ? checkIcon : atsWarningIcon}
							alt=""
							className="mt-0.5 size-5 shrink-0"
						/>
						<span>{suggestion.tip}</span>
					</li>
				))}
			</ul>

			<p className="mt-5 font-medium text-gray-800">
				Keep refining your resume to make your experience stand out.
			</p>
		</section>
	);
};

export default ATS;
