'use client';

import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient';

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const signedInr = (cents) => `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${inr(Math.abs(cents) / 100)}`;
const DEFAULT_PEOPLE = ['You', 'Aisha', 'Raj'];

const normalizeExpense = (expense, members = DEFAULT_PEOPLE) => ({
  id: expense.id,
  emoji: expense.emoji || '🧾',
  name: expense.name,
  paidBy: expense.paid_by,
  splitBetween: Array.isArray(expense.split_between) && expense.split_between.length
    ? expense.split_between
    : members,
  amount: Number(expense.amount),
});

function getMinimalTransfers(balances) {
  const memo = new Map();

  const settle = (remaining) => {
    const key = remaining.join(',');
    if (memo.has(key)) return memo.get(key);

    const first = remaining.findIndex((balance) => balance !== 0);
    if (first === -1) return [];

    let best = null;
    const seenBalances = new Set();
    for (let other = first + 1; other < remaining.length; other += 1) {
      if (remaining[first] * remaining[other] >= 0 || seenBalances.has(remaining[other])) continue;
      seenBalances.add(remaining[other]);

      const next = [...remaining];
      const amount = Math.min(Math.abs(next[first]), Math.abs(next[other]));
      const from = next[first] < 0 ? first : other;
      const to = next[first] > 0 ? first : other;
      next[first] += next[first] < 0 ? amount : -amount;
      next[other] += next[other] < 0 ? amount : -amount;

      const transfers = [{ from, to, amount }, ...settle(next)];
      if (!best || transfers.length < best.length) best = transfers;
      if (next[first] === 0 && next[other] === 0) break;
    }

    memo.set(key, best || []);
    return memo.get(key);
  };

  return settle(balances);
}

export default function SplitDashboard() {
  const [expenses, setExpenses] = useState([]);
  const [groups, setGroups] = useState([]);
  const [activeGroupId, setActiveGroupId] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [groupName, setGroupName] = useState('');
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [people, setPeople] = useState(['You', 'Aisha', 'Raj']);
  const [personName, setPersonName] = useState('');
  const [paidBy, setPaidBy] = useState('You');
  const [splitBetween, setSplitBetween] = useState(['You', 'Aisha', 'Raj']);
  const [expensesLoading, setExpensesLoading] = useState(false);
  const [text, setText] = useState('');
  const [split, setSplit] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [addingGroup, setAddingGroup] = useState(false);
  const [joiningGroup, setJoiningGroup] = useState(false);
  const activeGroup = groups.find((group) => group.id === activeGroupId);

  useEffect(() => {
    let active = true;
    console.log('Supabase URL in browser:', process.env.NEXT_PUBLIC_SUPABASE_URL);
    const loadGroups = async () => {
      if (!isSupabaseConfigured) {
        setError('Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to connect to Supabase.');
        return;
      }

      try {
        const { data, error: fetchError } = await supabase
          .from('groups')
          .select('id, name, join_code')
          .order('name', { ascending: true });
        if (!active) return;
        if (fetchError) {
          setError(fetchError.message);
          return;
        }

        const availableGroups = data || [];
        setGroups(availableGroups);
        if (availableGroups.length) setActiveGroupId(availableGroups[0].id);
      } catch (fetchError) {
        if (active) setError(fetchError.message || 'Could not load groups.');
      }
    };

    loadGroups();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setExpenses([]);
    if (!isSupabaseConfigured) {
      setExpensesLoading(false);
      return () => {
        active = false;
      };
    }

    if (!activeGroupId) {
      setExpensesLoading(false);
      return () => {
        active = false;
      };
    }

    const loadExpenses = async () => {
      setExpensesLoading(true);
      try {
        const { data, error: fetchError } = await supabase
          .from('expenses')
          .select('*')
          .eq('group_id', activeGroupId)
          .order('created_at', { ascending: false });
        if (!active) return;
        if (fetchError) {
          setError(fetchError.message);
          return;
        }
        setExpenses((data || []).map((expense) => normalizeExpense(expense)));
      } catch (fetchError) {
        if (active) setError(fetchError.message || 'Could not load expenses.');
      } finally {
        if (active) setExpensesLoading(false);
      }
    };

    loadExpenses();

    return () => {
      active = false;
    };
  }, [activeGroupId]);

  const totalCents = expenses.reduce((sum, expense) => sum + Math.round(Number(expense.amount || 0) * 100), 0);
  const memberNames = [...new Set([
    ...people,
    ...expenses.flatMap((expense) => [expense.paidBy, ...(expense.splitBetween || [])]),
  ].filter(Boolean))];
  const balances = memberNames.map((name) => {
    let paid = 0;
    let owed = 0;

    expenses.forEach((expense) => {
      const amount = Math.round(Number(expense.amount || 0) * 100);
      if (expense.paidBy === name) paid += amount;

      const members = expense.splitBetween?.length ? expense.splitBetween : people;
      const memberIndex = members.indexOf(name);
      if (memberIndex !== -1) {
        const share = Math.floor(amount / members.length);
        const remainder = amount % members.length;
        owed += share + (memberIndex < remainder ? 1 : 0);
      }
    });

    return { name, paid, net: paid - owed };
  });
  const transfers = getMinimalTransfers(balances.map((balance) => balance.net));

  const addPerson = (event) => {
    event.preventDefault();
    const name = personName.trim();
    if (!name || people.some((person) => person.toLowerCase() === name.toLowerCase())) return;

    setPeople((list) => [...list, name]);
    setPersonName('');
  };

  const addGroup = async (event) => {
    event.preventDefault();
    const name = groupName.trim();
    if (!name || addingGroup) return;
    if (!isSupabaseConfigured) {
      setError('Configure Supabase before creating a group.');
      return;
    }

    setAddingGroup(true);
    setError('');
    try {
      const { data, error: insertError } = await supabase
        .from('groups')
        .insert({ name })
        .select('id, name, join_code')
        .single();
      if (insertError) throw new Error(insertError.message);

      setGroups((list) => [...list, data].sort((a, b) => a.name.localeCompare(b.name)));
      setActiveGroupId(data.id);
      setGroupName('');
      setShowAddGroup(false);
    } catch (insertError) {
      setError(insertError.message || 'Could not create this group.');
    } finally {
      setAddingGroup(false);
    }
  };

  const joinGroup = async (event) => {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code || joiningGroup) return;
    if (!isSupabaseConfigured) {
      setError('Configure Supabase before joining a group.');
      return;
    }

    setJoiningGroup(true);
    setError('');
    try {
      const { data, error: lookupError } = await supabase
        .from('groups')
        .select('*')
        .eq('join_code', code)
        .single();
      if (lookupError) throw new Error(lookupError.message);
      if (!data) throw new Error('No group found for that join code.');

      setGroups((list) => list.some((group) => group.id === data.id) ? list : [...list, data]);
      setActiveGroupId(data.id);
      setJoinCode('');
    } catch (lookupError) {
      setError(lookupError.message || 'Could not find a group with that join code.');
    } finally {
      setJoiningGroup(false);
    }
  };

  const copyJoinCode = async () => {
    if (!activeGroup?.join_code) return;
    setCopyMessage('');
    try {
      await navigator.clipboard.writeText(activeGroup.join_code);
      setCopyMessage('Copied!');
    } catch (copyError) {
      setError(copyError.message || 'Could not copy the join code.');
    }
  };

  const addExpense = async (event) => {
    event.preventDefault();
    const t = text.trim();
    if (!t || !splitBetween.length || !activeGroupId || submitting) return;
    if (!isSupabaseConfigured) {
      setError('Configure Supabase before adding an expense.');
      return;
    }

    const expensePayer = paidBy;
    const expenseMembers = [...splitBetween];

    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t }),
      });
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(
          `The split API returned an invalid response (HTTP ${response.status}). Check that /api/split is available and try again.`,
        );
      }

      if (!response.ok) {
        throw new Error(data?.error || `Could not split this expense (HTTP ${response.status}). Please try again.`);
      }
      if (
        !data ||
        !Number.isFinite(data.amount) ||
        !Number.isInteger(data.people) ||
        !Number.isFinite(data.each) ||
        typeof data.description !== 'string'
      ) {
        throw new Error('The split API returned incomplete expense details. Please try again.');
      }

      const each = Math.round((data.amount / expenseMembers.length + Number.EPSILON) * 100) / 100;
      const { data: savedExpense, error: saveError } = await supabase.from('expenses')
        .insert([{
          name: data.description,
          amount: data.amount,
          paid_by: expensePayer || 'You',
          emoji: '💸',
          group_id: activeGroupId,
        }])
        .select()
        .single();
      if (saveError) throw new Error(saveError.message);

      const newExpense = normalizeExpense(savedExpense, expenseMembers);
      setExpenses((list) => [newExpense, ...list]);
      setSplit({ ...data, people: expenseMembers.length, each });
      setText('');
    } catch (requestError) {
      setError(requestError.message || 'Could not split this expense. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const removeExpense = async (id) => {
    setError('');
    if (!isSupabaseConfigured) {
      setError('Configure Supabase before deleting an expense.');
      return;
    }
    try {
      const { error: deleteError } = await supabase.from('expenses').delete().eq('id', id);
      if (deleteError) {
        setError(deleteError.message);
        return;
      }
      setExpenses((list) => list.filter((expense) => expense.id !== id));
    } catch (deleteError) {
      setError(deleteError.message || 'Could not delete this expense.');
    }
  };

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.brand}>
            <div style={styles.logo}>S</div>
            <div style={styles.title}>SplitSmart</div>
          </div>
          <div style={styles.headerGroupActions}>
            <select
              style={styles.groupSelect}
              aria-label="Select group"
              value={activeGroupId}
              onChange={(event) => setActiveGroupId(event.target.value)}
            >
              <option value="">Select group</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}{group.join_code ? ` · ${group.join_code}` : ''}
                </option>
              ))}
            </select>
            <button style={styles.addBtn} type="button" onClick={() => setShowAddGroup(true)}>
              Add Group
            </button>
          </div>
        </div>

        {activeGroup && (
          <div style={styles.activeGroupInfo}>
            <strong>{activeGroup.name}</strong>
            {activeGroup.join_code && (
              <>
                <code style={styles.joinCode}>{activeGroup.join_code}</code>
                <button style={styles.copyBtn} type="button" onClick={copyJoinCode}>Copy</button>
                {copyMessage && <span style={styles.copyMessage} role="status">{copyMessage}</span>}
              </>
            )}
          </div>
        )}

        <form style={styles.joinGroupForm} onSubmit={joinGroup}>
          <input
            style={styles.input}
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value)}
            placeholder="6-character join code"
            aria-label="Group join code"
            maxLength={6}
          />
          <button style={styles.addBtn} type="submit" disabled={joiningGroup || !joinCode.trim()}>
            {joiningGroup ? 'Joining…' : 'Join with Code'}
          </button>
        </form>

        {showAddGroup && (
          <div style={styles.modalBackdrop} role="presentation" onClick={() => setShowAddGroup(false)}>
            <section
              style={styles.groupModal}
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-group-title"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id="add-group-title" style={styles.sectionTitle}>Add Group</h2>
              <form style={styles.groupForm} onSubmit={addGroup}>
                <input
                  style={styles.input}
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder="e.g. Goa Trip"
                  aria-label="Group name"
                  required
                />
                <div style={styles.modalActions}>
                  <button
                    style={styles.cancelBtn}
                    type="button"
                    onClick={() => setShowAddGroup(false)}
                    disabled={addingGroup}
                  >
                    Cancel
                  </button>
                  <button style={styles.addBtn} type="submit" disabled={addingGroup || !groupName.trim()}>
                    {addingGroup ? 'Creating…' : 'Create Group'}
                  </button>
                </div>
              </form>
              {error && <div style={styles.error} role="alert">{error}</div>}
            </section>
          </div>
        )}

        <section style={styles.peopleSection} aria-label="Group people">
          <div style={styles.peopleHeading}>People <span>({people.length})</span></div>
          <div style={styles.peopleList}>
            {people.map((person) => (
              <span key={person} style={styles.person}>{person}</span>
            ))}
          </div>
          <form style={styles.addRow} onSubmit={addPerson}>
            <input
              style={styles.input}
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="Add a person"
              aria-label="Person's name"
            />
            <button style={styles.addBtn} type="submit" disabled={!personName.trim()}>
              Add
            </button>
          </form>
        </section>

        {/* Add an expense */}
        <form style={styles.expenseForm} onSubmit={addExpense}>
          <div style={styles.addRow}>
            <input
              style={styles.input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Dinner ₹1,800 split with 2 friends"
              aria-label="Describe an expense to split"
              disabled={submitting}
            />
            <button
              style={styles.addBtn}
              type="submit"
              disabled={submitting || !text.trim() || !splitBetween.length || !activeGroupId}
            >
              {submitting ? '…' : 'Split'}
            </button>
          </div>
          <label style={styles.payerField}>
            Paid by
            <select
              style={styles.select}
              value={paidBy}
              onChange={(event) => setPaidBy(event.target.value)}
              disabled={submitting}
            >
              {people.map((person) => <option key={person} value={person}>{person}</option>)}
            </select>
          </label>
          <fieldset style={styles.splitFieldset} disabled={submitting}>
            <legend style={styles.splitLegend}>Shared by</legend>
            <div style={styles.memberOptions}>
              {people.map((person) => (
                <label key={person} style={styles.memberOption}>
                  <input
                    type="checkbox"
                    checked={splitBetween.includes(person)}
                    onChange={(event) => {
                      setSplitBetween((members) => event.target.checked
                        ? [...members, person]
                        : members.filter((member) => member !== person));
                    }}
                  />
                  {person}
                </label>
              ))}
            </div>
          </fieldset>
        </form>

        {error && <div style={styles.error} role="alert">{error}</div>}

        {split && (
          <section style={styles.splitCard} aria-live="polite" aria-label="Expense split">
            <div style={styles.splitDescription}>{split.description}</div>
            <div style={styles.splitDetails}>
              <div><span style={styles.splitLabel}>Total</span><strong>{inr(split.amount)}</strong></div>
              <div><span style={styles.splitLabel}>People (incl. you)</span><strong>{split.people}</strong></div>
              <div><span style={styles.splitLabel}>Each</span><strong>₹{split.each.toFixed(2)}</strong></div>
            </div>
          </section>
        )}

        <section style={styles.summarySection} aria-label="Group balances">
          <h2 style={styles.sectionTitle}>Balances</h2>
          <div style={styles.list}>
            {balances.map((balance) => (
              <div key={balance.name} style={styles.balanceItem}>
                <strong>{balance.name}</strong>
                <span style={styles.balancePaid}>Paid {inr(balance.paid / 100)}</span>
                <strong style={{ ...styles.balanceNet, color: balance.net >= 0 ? '#17804a' : '#a32335' }}>
                  {signedInr(balance.net)}
                </strong>
              </div>
            ))}
          </div>
        </section>

        <section style={styles.summarySection} aria-label="Settle up">
          <h2 style={styles.sectionTitle}>Settle up</h2>
          {transfers.length === 0 ? (
            <div style={styles.empty}>Everyone is settled up.</div>
          ) : (
            <div style={styles.list}>
              {transfers.map((transfer, index) => (
                <div key={`${memberNames[transfer.from]}-${memberNames[transfer.to]}-${index}`} style={styles.transferItem}>
                  <strong>{memberNames[transfer.from]}</strong>
                  <span>pays</span>
                  <strong>{memberNames[transfer.to]}</strong>
                  <strong style={styles.itemAmount}>{inr(transfer.amount / 100)}</strong>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={styles.summarySection} aria-label="Logged expenses">
          <h2 style={styles.sectionTitle}>Expenses <span style={styles.expenseCount}>({expenses.length})</span></h2>
          <div style={styles.list}>
            {expensesLoading && <div style={styles.empty}>Loading expenses…</div>}
            {expenses.length === 0 && (
              <div style={styles.empty}>No expenses yet — add your first one above.</div>
            )}
            {expenses.map((expense) => (
              <div key={expense.id} style={styles.item}>
                <div style={styles.itemEmoji}>{expense.emoji || '🧾'}</div>
                <div style={styles.itemMain}>
                  <div style={styles.itemName}>{expense.name || expense.description}</div>
                  <div style={styles.itemPaid}>
                    Paid by {expense.paidBy} · Shared by {(expense.splitBetween || people).join(', ')}
                  </div>
                </div>
                <div style={styles.itemAmount}>{inr(expense.amount)}</div>
                <button
                  type="button"
                  style={styles.remove}
                  onClick={() => removeExpense(expense.id)}
                  aria-label={`Remove ${expense.name || expense.description}`}
                >×</button>
              </div>
            ))}
          </div>
          <div style={styles.total}>Total {inr(totalCents / 100)}</div>
        </section>
      </div>

      <p style={styles.footnote}>
        SplitSmart starter · deepEntra Academy — Build &amp; Ship It.<br />
        This is the basic app — you&apos;ll add the AI and a real database next.
      </p>
    </main>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: '28px 16px 48px',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    background: 'var(--card)',
    borderRadius: 24,
    boxShadow: '0 24px 60px -24px rgba(13,27,62,.28)',
    border: '1px solid var(--line)',
    padding: 20,
    marginTop: 12,
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  brand: { display: 'flex', alignItems: 'center', gap: 10 },
  logo: {
    width: 36, height: 36, borderRadius: 11, display: 'grid', placeItems: 'center',
    color: '#fff', fontWeight: 800, fontSize: 18,
    background: 'linear-gradient(135deg, var(--blue), var(--cyan))',
    boxShadow: '0 8px 18px -6px rgba(28,95,212,.55)',
  },
  title: { fontSize: 20, fontWeight: 800, letterSpacing: '-0.01em' },
  headerGroupActions: { display: 'flex', alignItems: 'center', gap: 8 },
  activeGroupInfo: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    marginBottom: 14, color: 'var(--ink)', fontSize: 13,
  },
  joinCode: {
    padding: '4px 8px', borderRadius: 7, background: '#f2f5fb',
    color: 'var(--blue)', fontSize: 12, letterSpacing: '0.08em',
  },
  copyBtn: {
    border: '1px solid var(--line)', borderRadius: 8, background: '#fff',
    color: 'var(--blue)', fontSize: 12, fontWeight: 700, padding: '5px 9px',
  },
  copyMessage: { color: '#176b42', fontSize: 12 },
  joinGroupForm: { display: 'flex', gap: 10, marginBottom: 18 },
  groupSelect: {
    maxWidth: 180, border: '1px solid var(--line)', borderRadius: 999,
    padding: '8px 10px', fontSize: 12.5, fontWeight: 700, background: '#fff', color: 'var(--ink)',
  },
  modalBackdrop: {
    position: 'fixed', inset: 0, zIndex: 10, display: 'grid', placeItems: 'center',
    padding: 16, background: 'rgba(13,27,62,.45)',
  },
  groupModal: {
    width: '100%', maxWidth: 360, background: 'var(--card)', borderRadius: 20,
    border: '1px solid var(--line)', boxShadow: '0 24px 60px -24px rgba(13,27,62,.4)', padding: 20,
  },
  groupForm: { display: 'flex', flexDirection: 'column', gap: 12 },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 10 },
  cancelBtn: {
    border: '1px solid var(--line)', borderRadius: 14, background: '#fff',
    color: 'var(--ink)', fontSize: 14, fontWeight: 700, padding: '0 14px',
  },
  peopleSection: { marginBottom: 18 },
  summarySection: { marginTop: 20 },
  sectionTitle: { fontSize: 16, margin: '0 0 10px' },
  expenseCount: { color: 'var(--muted)', fontWeight: 500, fontSize: 13 },
  peopleHeading: { fontSize: 14, fontWeight: 800, marginBottom: 9 },
  peopleList: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  person: {
    color: 'var(--blue)', background: 'rgba(28,95,212,.1)', borderRadius: 999,
    padding: '6px 10px', fontSize: 12.5, fontWeight: 700,
  },
  addRow: { display: 'flex', gap: 10, marginBottom: 16 },
  expenseForm: { display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 },
  input: {
    flex: 1, border: '1px solid var(--line)', borderRadius: 14, padding: '13px 15px',
    fontSize: 15, outline: 'none', background: '#f7f9fc', color: 'var(--ink)',
  },
  addBtn: {
    flex: 'none', minWidth: 72, borderRadius: 14, border: 'none', color: '#fff', fontSize: 15, fontWeight: 700,
    padding: '0 12px',
    background: 'linear-gradient(135deg, var(--blue), var(--cyan))',
    boxShadow: '0 10px 22px -8px rgba(28,95,212,.6)',
  },
  payerField: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 14, fontWeight: 700 },
  select: {
    flex: 1, border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px',
    fontSize: 14, background: '#f7f9fc', color: 'var(--ink)',
  },
  splitFieldset: { border: '1px solid var(--line)', borderRadius: 14, padding: '10px 12px 12px', margin: 0 },
  splitLegend: { fontSize: 14, fontWeight: 700, padding: '0 4px' },
  memberOptions: { display: 'flex', flexWrap: 'wrap', gap: '10px 16px' },
  memberOption: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 },
  error: {
    color: '#a32335', background: '#fff1f2', border: '1px solid #f5c2c7',
    borderRadius: 12, padding: '10px 12px', fontSize: 13, marginBottom: 16,
  },
  splitCard: {
    background: '#f7f9fc', border: '1px solid var(--line)', borderRadius: 16,
    padding: '14px 16px', marginBottom: 16,
  },
  splitDescription: { fontWeight: 800, fontSize: 16, marginBottom: 12 },
  splitDetails: { display: 'flex', justifyContent: 'space-between', gap: 10 },
  splitLabel: { display: 'block', color: 'var(--muted)', fontSize: 12, marginBottom: 4 },
  list: { display: 'flex', flexDirection: 'column', gap: 10, minHeight: 60 },
  empty: { color: 'var(--muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' },
  item: {
    display: 'flex', alignItems: 'center', gap: 12,
    background: '#f7f9fc', border: '1px solid var(--line)', borderRadius: 16, padding: '12px 14px',
  },
  itemEmoji: {
    width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center',
    background: '#fff', border: '1px solid var(--line)', fontSize: 19, flex: 'none',
  },
  itemMain: { flex: 1, minWidth: 0 },
  itemName: { fontWeight: 700, fontSize: 15 },
  itemPaid: { color: 'var(--muted)', fontSize: 12.5, marginTop: 1 },
  itemAmount: { fontWeight: 800, fontSize: 15.5, fontVariantNumeric: 'tabular-nums' },
  balanceItem: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    background: '#f7f9fc', border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px',
  },
  balancePaid: { color: 'var(--muted)', fontSize: 12.5, marginLeft: 'auto' },
  balanceNet: { minWidth: 75, textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  transferItem: {
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
    background: '#f7f9fc', border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px',
  },
  remove: {
    flex: 'none', width: 26, height: 26, borderRadius: 8, border: 'none',
    background: 'transparent', color: 'var(--muted)', fontSize: 20, lineHeight: 1,
  },
  total: {
    textAlign: 'center', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)',
    fontWeight: 800, fontSize: 16, color: 'var(--ink)',
  },
  footnote: { color: 'var(--muted)', fontSize: 12.5, textAlign: 'center', lineHeight: 1.6, marginTop: 20, maxWidth: 420 },
};
