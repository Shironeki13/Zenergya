import { DataProvider } from '@/context/data-context';

export default function LoginLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">

            {/* Animated Waves Background */}
            <div className="absolute bottom-0 w-full z-0">
                <svg className="waves" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink"
                    viewBox="0 24 150 28" preserveAspectRatio="none" shapeRendering="auto">
                    <defs>
                        <path id="gentle-wave" d="M-160 44c30 0 58-18 88-18s 58 18 88 18 58-18 88-18 58 18 88 18 v44h-352z" />
                    </defs>
                    <g className="parallax">
                        <use xlinkHref="#gentle-wave" x="48" y="0" fill="rgba(6, 182, 212, 0.7)" />
                        <use xlinkHref="#gentle-wave" x="48" y="3" fill="rgba(59, 130, 246, 0.5)" />
                        <use xlinkHref="#gentle-wave" x="48" y="5" fill="rgba(147, 51, 234, 0.3)" />
                        <use xlinkHref="#gentle-wave" x="48" y="7" fill="rgba(6, 182, 212, 0.9)" />
                    </g>
                </svg>
            </div>

            {/* Content */}
            <div className="relative z-10 w-full max-w-md px-4">
                {children}
            </div>
        </div>
    );
}
