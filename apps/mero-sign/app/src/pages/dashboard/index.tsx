import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAccessToken,
  getAppEndpointKey,
  getApplicationId,
  getRefreshToken,
} from '@calimero-network/calimero-client';
import {
  FileText,
  Users,
  Search,
  Plus,
  MoreVertical,
  ArrowRight,
  Clock,
  Layers,
  X,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Button, Card, CardContent } from '../../components/ui';
import { MobileLayout } from '../../components/MobileLayout';
import { useTheme } from '../../contexts/ThemeContext';

export default function Dashboard() {
  const navigate = useNavigate();
  const { mode } = useTheme();
  const url = getAppEndpointKey();
  const applicationId = getApplicationId();
  const accessToken = getAccessToken();
  const refreshToken = getRefreshToken();
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [agreementName, setAgreementName] = useState('');

  useEffect(() => {
    if (!url || !applicationId) {
      navigate('/setup');
      return;
    }

    if (!accessToken || !refreshToken) {
      navigate('/auth');
    }
  }, [accessToken, applicationId, navigate, refreshToken, url]);

  // Mock data for agreements
  const mockContexts = [
    {
      id: '1',
      name: 'Legal Team Workspace',
      description: 'Contract management and legal document collaboration',
      participants: 4,
      documents: 8,
      pendingSignatures: 3,
      lastActivity: '2 hours ago',
      status: 'active',
      category: 'legal',
      owner: 'Sarah Johnson',
      created: '2 weeks ago',
    },
  ];

  const stats = [
    {
      label: 'Active Agreements',
      value: mockContexts.filter((c) => c.status === 'active').length,
      icon: Layers,
      color: 'text-blue-600',
      bg: 'bg-blue-100 dark:bg-blue-900/20',
    },
  ];

  const filteredContexts = mockContexts.filter((context) => {
    const matchesSearch =
      context.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      context.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  const handleCreateAgreement = () => {
    if (agreementName.trim()) {
      setShowCreateModal(false);
      setAgreementName('');

      navigate('/agreement');
    }
  };

  const handleOpenCreateModal = () => {
    setShowCreateModal(true);
  };

  const handleCloseCreateModal = () => {
    setShowCreateModal(false);
    setAgreementName('');
  };

  return (
    <MobileLayout>
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-6"
      >
        {/* Header */}
        <motion.section variants={itemVariants} className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1">
              Dashboard
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground">
              Manage your agreements and documents
            </p>
          </div>

          {/* Button and Stats Row */}
          <div className="flex items-stretch gap-3 sm:gap-4">
            <Button
              onClick={handleOpenCreateModal}
              className="group flex-shrink-0 dark:text-black h-[52px] px-4"
              size="sm"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Agreement
            </Button>

            <div className="flex-1">
              {stats.map((stat, index) => {
                const Icon = stat.icon;
                return (
                  <Card
                    key={index}
                    className="p-3 hover:shadow-lg transition-all duration-300 w-full h-[52px]"
                  >
                    <div className="flex items-center gap-3 h-full">
                      <div
                        className={`p-2 rounded-full ${stat.bg} flex-shrink-0`}
                      >
                        <Icon className={`w-4 h-4 ${stat.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-lg sm:text-xl font-bold text-foreground">
                          {stat.value}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {stat.label}
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        </motion.section>

        {/* Search */}
        <motion.section variants={itemVariants} className="px-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search agreements ..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 sm:py-3 text-sm sm:text-base border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300"
            />
          </div>
        </motion.section>

        {/* Context Cards */}
        <motion.section variants={itemVariants}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground">
              Your Agreements
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {filteredContexts.map((context) => (
              <motion.div
                key={context.id}
                whileHover={{ y: -2, scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
              >
                <Card
                  className="group cursor-pointer h-full hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 border-border/50 hover:border-primary/20"
                  onClick={() => navigate('/agreement')}
                >
                  <CardContent className="p-4 sm:p-6">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-3 sm:mb-4">
                      <div className="flex-1">
                        <h3 className="font-semibold text-sm sm:text-base text-foreground mb-1 group-hover:text-primary transition-colors duration-300 line-clamp-1">
                          {context.name}
                        </h3>
                        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed line-clamp-2">
                          {context.description}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="p-1 h-5 w-5 sm:h-6 sm:w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <MoreVertical className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                      </Button>
                    </div>

                    {/* Content */}
                    <div className="space-y-2.5 sm:space-y-3">
                      {/* Stats */}
                      <div className="flex items-center space-x-3 sm:space-x-4 text-xs sm:text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3 sm:w-4 sm:h-4" />
                          {context.participants}
                        </span>
                        <span className="flex items-center gap-1">
                          <FileText className="w-3 h-3 sm:w-4 sm:h-4" />
                          {context.documents}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 sm:w-4 sm:h-4" />
                          {context.pendingSignatures}
                        </span>
                      </div>

                      {/* Footer */}
                      <div className="flex items-center justify-between pt-2 border-t border-border/50">
                        <span className="text-xs text-muted-foreground">
                          {context.lastActivity}
                        </span>
                        <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all duration-300" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </motion.section>
      </motion.div>

      {/* Create Agreement Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={`rounded-lg p-6 w-full max-w-md border border-border shadow-2xl ${
              mode === 'dark' ? 'bg-gray-900' : 'bg-white'
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">
                Create New Agreement
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCloseCreateModal}
                className="p-1 h-auto w-auto"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="agreementName"
                  className="block text-sm font-medium text-foreground mb-2"
                >
                  Agreement Name
                </label>
                <input
                  id="agreementName"
                  type="text"
                  value={agreementName}
                  onChange={(e) => setAgreementName(e.target.value)}
                  placeholder="Enter agreement name..."
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  autoFocus
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  onClick={handleCloseCreateModal}
                  variant="outline"
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateAgreement}
                  className="flex-1 dark:text-black"
                  disabled={!agreementName.trim()}
                >
                  Create
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </MobileLayout>
  );
}
