import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Trash2 } from 'lucide-react'

export default function SupplierMatrix({ suppliers, requirements, projectId, onDeleteSupplier, supplierCumulativeAnalysis = {} }) {
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
                <th className="text-left py-3 px-4 font-semibold text-gray-700 sticky left-0 bg-white z-10 w-48">
                  Supplier
                </th>
                {requirements.map((req) => (
                  <th
                    key={req.id}
                    className="text-center py-3 px-2 font-semibold text-gray-700 text-xs whitespace-nowrap"
                    title={req.label}
                  >
                    <div className="w-6 h-6 rounded-full mx-auto mb-1 bg-gray-200"></div>
                    <span className="text-xs">{req.label.substring(0, 8)}</span>
                  </th>
                ))}
                <th className="text-center py-3 px-4 font-semibold text-gray-700 whitespace-nowrap sticky right-0 bg-white z-10">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id} className="border-b border-gray-100 hover:bg-gray-50 group">
                  <td className="py-4 px-4 sticky left-0 bg-inherit group-hover:bg-gray-50 z-10">
                    <Link href={`/project/${projectId}/supplier/${supplier.id}`}>
                      <a className="block cursor-pointer hover:underline">
                        <p className="font-semibold text-gray-900">{supplier.nickname}</p>
                        <p className="text-xs text-gray-500 truncate" title={supplier.url}>{supplier.url}</p>
                      </a>
                    </Link>
                  </td>
                  {requirements.map((req) => {
                    // Get status from cumulative analysis if available, otherwise from requirement
                    let status = 'missing'
                    if (supplierCumulativeAnalysis[supplier.id]) {
                      const cumulativeReq = supplierCumulativeAnalysis[supplier.id].find(r => r.label === req.label)
                      if (cumulativeReq) {
                        status = cumulativeReq.status
                      }
                    }
                    return (
                      <td key={req.id} className="text-center py-4 px-2">
                        <Link href={`/project/${projectId}/supplier/${supplier.id}`}>
                          <a className="inline-block cursor-pointer">
                            <div
                              className={`w-6 h-6 rounded-full mx-auto transition hover:scale-110 ${getStatusColor(status)}`}
                              title={status}
                            />
                          </a>
                        </Link>
                      </td>
                    )
                  })}
                  <td className="text-center py-4 px-4 sticky right-0 bg-inherit group-hover:bg-gray-50 z-10">
                    <div className="flex items-center justify-center gap-2">
                      {onDeleteSupplier && (
                        <button
                          onClick={() => onDeleteSupplier(supplier.id)}
                          className="text-red-500 hover:text-red-700 p-1"
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
