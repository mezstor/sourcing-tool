import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Trash2 } from 'lucide-react'

export default function SupplierMatrix({ suppliers, requirements, projectId, onDeleteSupplier }) {
  const getStatusColor = (status) => {
    switch (status) {
      case 'confirmed':
        return 'bg-green-500'
      case 'conflict':
        return 'bg-red-500'
      case 'missing':
      case 'pending':
        return 'bg-gray-400'
      default:
        return 'bg-gray-400'
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Supplier Matrix</h2>

      {suppliers.length === 0 ? (
        <div className="text-center py-8 text-gray-600">
          No suppliers added yet
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Supplier
                </th>
                {requirements.map((req) => (
                  <th
                    key={req.id}
                    className="text-center py-3 px-2 font-semibold text-gray-700 text-xs"
                    title={req.label}
                  >
                    {req.label.substring(0, 10)}
                  </th>
                ))}
                <th className="text-center py-3 px-4 font-semibold text-gray-700">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-4 px-4">
                    <div>
                      <p className="font-semibold text-gray-900">{supplier.nickname}</p>
                      <p className="text-xs text-gray-500 truncate">{supplier.url}</p>
                    </div>
                  </td>
                  {requirements.map((req) => (
                    <td key={req.id} className="text-center py-4 px-2">
                      <div
                        className={`w-6 h-6 rounded-full mx-auto ${getStatusColor(
                          req.status || 'missing'
                        )}`}
                        title={req.status || 'missing'}
                      />
                    </td>
                  ))}
                  <td className="text-center py-4 px-4">
                    <div className="flex items-center justify-center gap-2">
                      <Link href={`/project/${projectId}/supplier/${supplier.id}`}>
                        <a className="text-indigo-600 hover:text-indigo-700 flex items-center justify-center gap-1">
                          <span className="text-xs">Audit</span>
                          <ChevronRight size={16} />
                        </a>
                      </Link>
                      {onDeleteSupplier && (
                        <button
                          onClick={() => onDeleteSupplier(supplier.id)}
                          className="text-red-500 hover:text-red-700"
                          title="Delete supplier"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
