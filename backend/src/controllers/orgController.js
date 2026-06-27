import db from '../db/connection.js';
import { logger } from '../config/logger.js';

export const getOrganizations = async (req, res, next) => {
  try {
    const orgs = await db('organizations').select('*').orderBy('id', 'asc');
    res.json(orgs);
  } catch (error) {
    logger.error(`Failed to retrieve organizations: ${error.message}`);
    next(error);
  }
};

export const createOrganization = async (req, res, next) => {
  const { name, organization_type, status } = req.body;

  try {
    if (!name || !organization_type) {
      return res.status(400).json({ error: 'Name and organization_type are required' });
    }

    const validTypes = ['individual', 'university', 'hospital', 'research_center', 'startup', 'saas_tenant'];
    if (!validTypes.includes(organization_type)) {
      return res.status(400).json({ error: `Invalid organization_type. Must be one of: ${validTypes.join(', ')}` });
    }

    const [newOrg] = await db('organizations')
      .insert({
        name,
        organization_type,
        status: status || 'active'
      })
      .returning('*');

    logger.info(`Organization created: ${name} (ID: ${newOrg.id})`);
    res.status(201).json(newOrg);
  } catch (error) {
    logger.error(`Failed to create organization: ${error.message}`);
    next(error);
  }
};

export const getOrganizationById = async (req, res, next) => {
  const { id } = req.params;
  try {
    const org = await db('organizations').where({ id }).first();
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    res.json(org);
  } catch (error) {
    logger.error(`Failed to retrieve organization ${id}: ${error.message}`);
    next(error);
  }
};

export const updateOrganization = async (req, res, next) => {
  const { id } = req.params;
  const { name, organization_type, status } = req.body;

  try {
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (organization_type !== undefined) {
      const validTypes = ['individual', 'university', 'hospital', 'research_center', 'startup', 'saas_tenant'];
      if (!validTypes.includes(organization_type)) {
        return res.status(400).json({ error: 'Invalid organization type' });
      }
      updateData.organization_type = organization_type;
    }
    if (status !== undefined) updateData.status = status;

    const updated = await db('organizations')
      .where({ id })
      .update(updateData);

    if (!updated) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    logger.info(`Organization ${id} updated.`);
    res.json({ success: true, message: 'Organization updated successfully' });
  } catch (error) {
    logger.error(`Failed to update organization ${id}: ${error.message}`);
    next(error);
  }
};

export const deleteOrganization = async (req, res, next) => {
  const { id } = req.params;
  try {
    const deleted = await db('organizations').where({ id }).del();
    if (!deleted) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    logger.info(`Organization ${id} deleted.`);
    res.json({ success: true, message: 'Organization deleted successfully' });
  } catch (error) {
    logger.error(`Failed to delete organization ${id}: ${error.message}`);
    next(error);
  }
};
