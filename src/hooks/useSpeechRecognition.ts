import { useState, useRef, useCallback } from 'react';

export const useSpeechRecognition = (onFinalSpeech: (text: string) => void) => {
  const [liveTranscript, setLiveTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const handleSpeechResult = useCallback((event: any) => {
    let interim = '';
    let final = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        final += event.results[i][0].transcript;
      } else {
        interim += event.results[i][0].transcript;
      }
    }

    if (final && final.trim()) {
      onFinalSpeech(final.trim());
      // Immediately flush buffer to prevent accumulation
      setLiveTranscript('');
    } else {
      setLiveTranscript(interim);
    }
  }, [onFinalSpeech]);

  const clearTranscript = useCallback(() => {
    setLiveTranscript('');
  }, []);

  const startListening = useCallback(() => {
    if (typeof window === 'undefined') return false;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('SpeechRecognition API is not supported in this browser.');
      return false;
    }

    try {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        clearTranscript();
      };

      recognition.onresult = handleSpeechResult;

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error event:', event.error);
        if (event.error !== 'no-speech') {
          setIsListening(false);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
      return true;
    } catch (err) {
      console.warn('Speech recognition start failed:', err);
      setIsListening(false);
      return false;
    }
  }, [handleSpeechResult, clearTranscript]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    setIsListening(false);
    clearTranscript();
  }, [clearTranscript]);

  return { 
    liveTranscript, 
    clearTranscript, 
    handleSpeechResult,
    isListening,
    startListening,
    stopListening
  };
};
