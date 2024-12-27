import { assert } from "vitest";

/**
 * Implements format=flowed (RFC 2646, RFC 3676),
 * and converts HTML to format=flowed.
 *
 * @param html
 * @param inlineHTMLToTextConverter Function to run for each paragraph.
 *   @param inline {DOM} The part within block-level elements,
 *     like `<p>`, <div>`, `<br>`.
 *   @returns plain text,
 *     possibly with markdown or other plaintext formatting,
 *     but without line breaks.
 * @param emptyLineAfterP {boolean} (optional, default false)
 *     Emit an empty line in the plaintext after each `<p>`
 * @returns format=flowed
 */
export function convertHTMLToFormatFlowed(html: string,
  inlineHTMLToTextConverter: ((inline: any) => string) | null,
  emptyLineAfterP = false,
): string {

}

/**
 * Implements format=flowed (RFC 2646, RFC 3676),
 * and converts format=flowed to HTML.
 *
 * @param formatFlowed
 * @param options
 *   @param inlineTextToHTMLConverter Function to run for each paragraph.
 *   @param inline {string} The part within a `<p>`, <div>`, `<br>`.
 *   @returns HTML,
 *     possibly with inline HTML elements, like `<bold>`, `<a href="">` etc.,
 *     but without block-level elements.
 *   @param delSp {boolean} (Optional, default false)
 *     Content-Type: text/plain; format=flowed; delsp=yes
 * @returns HTML
 */
export function convertFormatFlowedToHTML(formatFlowed: string,
  inlineTextToHTMLConverter: ((inline: string) => string) | null,
  delSp = false): string {
  let lines = formatFlowed.split("\n");
  let htmlE: HTMLElement = document.createElement("html");
  let bodyE: HTMLElement = document.createElement("body");
  htmlE.appendChild(bodyE);
  let textBlock = ""; // flowing lines wrapped into a single string
  let previousQuoteLevel = 0;
  let currentE: HTMLElement = bodyE;
  for (let line of lines) {
    if (line.startsWith(">")) {
      let quoteLevel = 0;
      for (; line[quoteLevel] == ">"; quoteLevel++) {
      }
      line = line.slice(quoteLevel);
      let quoteLevelDifference = quoteLevel - previousQuoteLevel;
      // console.log("quote level", quoteLevel, "previous", previousQuoteLevel, "diff", quoteLevelDifference);
      previousQuoteLevel = quoteLevel;
      if (quoteLevelDifference == 0) {
        // do nothing
      } else if (quoteLevelDifference > 0) {
        // add `<blockquote>`
        for (let i = 0; i < quoteLevelDifference; i++) {
          // Close any other block level elements before the quote, e.g. signatures
          while (currentE.nodeName != "BLOCKQUOTE" && currentE.nodeName != "BODY" && currentE.parentElement) {
            currentE = currentE.parentElement;
          }
          let blockquoteE = document.createElement("blockquote");
          blockquoteE.setAttribute("type", "cite");
          currentE.appendChild(blockquoteE);
          currentE = blockquoteE;
        }
      } else if (quoteLevelDifference < 0) {
        // close `<blockquote>`
        for (let i = 0; i < -quoteLevelDifference; i++) {
          // Close any other block level elements within the quote
          while (currentE.nodeName != "BLOCKQUOTE" && currentE.nodeName != "BODY" && currentE.parentElement) {
            currentE = currentE.parentElement;
          }
          assert(currentE.parentElement, "Not enough <blockquote>s");
          currentE = currentE.parentElement;
        }
      }
    }
    if (line == "-- ") {
      let signatureE = document.createElement("footer");
      currentE.appendChild(signatureE);
      currentE = signatureE;
      continue;
      /* Don't need to explicitly close the `<footer>`, because
       * a) If it's in a quote, or before a quote, then the blockquote logic will close the element.
       * b) It it's a sig of this email, then by definition it spans until the end of the document. */
    }
    if (line.startsWith(" ")) {
      line = line.slice(1);
    }

    // Flowed line
    if (line.endsWith(" ")) {
      if (delSp) {
        line = line.slice(0, -1);
      }
      textBlock += line;
      continue;
    }

    // End of flowed lines, or fixed line
    textBlock += line;

    let pE = document.createElement("p");
    if (inlineTextToHTMLConverter) {
      pE.innerHTML = inlineTextToHTMLConverter(textBlock);
    } else {
      pE.textContent = textBlock;
    }
    currentE.appendChild(pE);
    textBlock = "";
  }

  // Convert HTML DOM to HTML string
  return new XMLSerializer().serializeToString(htmlE);
}
