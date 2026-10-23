import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const body = await request.json();
    const sentence = body.sentence || body.text || body.input || body.prompt || '';

    if (!sentence) {
      return NextResponse.json({ error: 'Sentence is required' }, { status: 400 });
    }

    // Extract numbers (e.g. 300, 1200, 1800)
    const amountMatch = sentence.match(/(?:₹|\$|rs\.?|inr)?\s*(\d+(?:,\d+)*(?:\.\d+)?)/i);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;

    // Detect people mentioned in the prompt
    const defaultPeople = ['you', 'me', 'aisha', 'raj', 'priya'];
    const lower = sentence.toLowerCase();
    const matchedPeople = defaultPeople.filter(p => lower.includes(p));
    
    // Check for phrases like "split with 2 friends"
    const splitCountMatch = lower.match(/(\d+)\s*(?:people|friends|others)/);
    let peopleCount = matchedPeople.length > 0 ? matchedPeople.length : 1;
    if (splitCountMatch) {
      peopleCount = parseInt(splitCountMatch[1], 10);
    }

    const each = peopleCount > 0 ? Math.round(amount / peopleCount) : amount;
    
    // Create a clean description
    let description = sentence.replace(/(?:₹|\$|rs\.?|inr)?\s*\d+(?:,\d+)*(?:\.\d+)?/gi, '').trim();
    if (!description || description.length < 3) {
      description = 'Shared expense';
    }

    return NextResponse.json({
      amount: amount || 0,
      people: peopleCount,
      each: each,
      description: description
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}