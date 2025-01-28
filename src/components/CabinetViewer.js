import React, { useState } from 'react';
import axios from 'axios';
import { Document, Page, pdfjs } from 'react-pdf';
import '../App.css';
const YOUR_API_KEY = "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";
// Configure PDF.js worker

//pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  //'pdfjs-dist/build/pdf.worker.min.mjs',
 // import.meta.url,
//).toString();
// Replace your current worker configuration with this
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

function CabinetViewer() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    setFile(file);
  };
  const convertPdfToBase64Images = async (pdfFile) => {
    const pdf = await pdfjs.getDocument(URL.createObjectURL(pdfFile)).promise;
    const images = [];
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;
      
      images.push(canvas.toDataURL('image/jpeg').split(',')[1]);
      
      // Save the image file
      // const fileName = `page_${i}.jpg`;
      // canvas.toBlob((blob) => {
      //   const url = window.URL.createObjectURL(blob);
      //   const link = document.createElement('a');
      //   link.href = url;
      //   link.download = fileName;
      //   document.body.appendChild(link);
      //   link.click();
      //   document.body.removeChild(link);
      //   window.URL.revokeObjectURL(url);
      // }, 'image/jpeg', 1.0);
    }
    
    return images;
  };



  
  
  
  const processFile = async () => {
    if (!file) return;
    setLoading(true);
    
    try {
      const base64Images = await convertPdfToBase64Images(file);
      let allData = [];
      for (let i = 0; i < base64Images.length; i++) {
        const aiResponse = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
          model: "anthropic/claude-3-sonnet-20240229",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Extract all information from this document page and return as JSON data. Include any measurements, specifications, and details exactly as shown."
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/jpeg;base64,${base64Images[i]}`
                  }
                }
              ]
            }
          ]
        }, {
          headers: {
            'Authorization': `Bearer ${YOUR_API_KEY}`,
            'HTTP-Referer': window.location.origin,
            'Content-Type': 'application/json'
          }
        });
        if (aiResponse.data?.choices?.[0]) {
          const pageData = aiResponse.data.choices[0].message.content;
          allData.push({
            page: i + 1,
            data: pageData
          });
        }
      }
      setResult(allData);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="cabinet-viewer">
      <div className="header">
        <img src="/lowes-logo.png" alt="Norshin's Logo" className="logo" />
        <h1>Cabinet Specification Viewer</h1>
      </div>
      <div className="upload-section">
        <input 
          type="file" 
          accept=".pdf"
          onChange={handleFileUpload}
          className="file-input"
        />
        <button 
          onClick={processFile} 
          disabled={!file || loading}
          className="process-button"
        >
          {loading ? 'Processing...' : 'Process File'}
        </button>
      </div>
      {result && (
  <div className="results-section">
    {result.map((page, index) => {
      // Try to parse the JSON string if it's not already an object
      let pageData;
      try {
        pageData = typeof page.data === 'string' ? JSON.parse(page.data) : page.data;
      } catch (e) {
        pageData = page.data;
      }
      return (
        <div key={index} className="page-content">
          <h2>Page {page.page}</h2>
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(pageData || {}).map(([key, value], i) => (
                  <tr key={i}>
                    <td className="field-name">{key}</td>
                    <td className="field-value">
                      {typeof value === 'object' 
                        ? JSON.stringify(value, null, 2)
                        : value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    })}
  </div>
)}
    </div>
  );
}
export default CabinetViewer;
