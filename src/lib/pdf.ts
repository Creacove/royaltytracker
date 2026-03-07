type ExportElementToPdfOptions = {
  filename: string;
  margin?: number;
};

function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

async function deliverPdf(pdf: { output: (type: "blob") => Blob; save: (filename: string) => void }, filename: string): Promise<void> {
  const blob = pdf.output("blob");

  if (typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof File !== "undefined") {
    const file = new File([blob], filename, { type: "application/pdf" });
    const canShareFiles =
      typeof (navigator as Navigator & { canShare?: (data?: ShareData) => boolean }).canShare === "function" &&
      (navigator as Navigator & { canShare?: (data?: ShareData) => boolean }).canShare?.({ files: [file] });

    if (canShareFiles) {
      await navigator.share({
        title: filename,
        files: [file],
      });
      return;
    }
  }

  const objectUrl = URL.createObjectURL(blob);

  try {
    if (isMobileBrowser()) {
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}

async function waitForImages(element: HTMLElement): Promise<void> {
  const images = Array.from(element.querySelectorAll("img"));
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }

          const finalize = () => {
            image.removeEventListener("load", finalize);
            image.removeEventListener("error", finalize);
            resolve();
          };

          image.addEventListener("load", finalize, { once: true });
          image.addEventListener("error", finalize, { once: true });
        }),
    ),
  );
}

function sanitizeFilename(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export function buildSnapshotPdfFilename(title: string, fromDate: string, toDate: string): string {
  const base = sanitizeFilename(title) || "snapshot";
  return `${base}-${fromDate}-to-${toDate}.pdf`;
}

export async function exportElementToPdf(
  element: HTMLElement,
  { filename, margin = 24 }: ExportElementToPdfOptions,
): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  element.setAttribute("data-exporting-pdf", "true");

  try {
    await waitForImages(element);

    const canvas = await html2canvas(element, {
      backgroundColor: "#f8f7f2",
      scale: Math.max(2, window.devicePixelRatio || 1),
      useCORS: true,
      allowTaint: true,
      logging: false,
      scrollX: 0,
      scrollY: -window.scrollY,
      windowWidth: Math.max(element.scrollWidth, window.innerWidth),
      windowHeight: Math.max(element.scrollHeight, window.innerHeight),
      ignoreElements: (node) =>
        node instanceof HTMLElement && node.dataset.exportIgnore === "true",
    });

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: "a4",
      compress: true,
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const contentWidth = pageWidth - margin * 2;
    const contentHeight = pageHeight - margin * 2;
    const imageWidth = contentWidth;
    const imageHeight = (canvas.height * imageWidth) / canvas.width;
    const imageData = canvas.toDataURL("image/png", 1);

    let heightLeft = imageHeight;
    let position = margin;

    pdf.addImage(imageData, "PNG", margin, position, imageWidth, imageHeight, undefined, "FAST");
    heightLeft -= contentHeight;

    while (heightLeft > 0) {
      position = margin - (imageHeight - heightLeft);
      pdf.addPage();
      pdf.addImage(imageData, "PNG", margin, position, imageWidth, imageHeight, undefined, "FAST");
      heightLeft -= contentHeight;
    }

    await deliverPdf(pdf, filename);
  } finally {
    element.removeAttribute("data-exporting-pdf");
  }
}
