'use client';
import { useParams } from 'next/navigation';
import BillEditor from '../BillEditor';
export default function BillPage() { const { id } = useParams<{ id: string }>(); return <BillEditor key={id} id={id} />; }